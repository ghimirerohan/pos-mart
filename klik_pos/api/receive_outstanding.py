# Copyright (c) Klik POS / Beveren Software Inc.
# Receive Outstanding: prepare and submit Payment Entries against customer invoices (FIFO).

import json
import frappe
from frappe import _
from frappe.utils import flt, getdate, nowdate

from klik_pos.api.sales_invoice import get_current_pos_opening_entry
from klik_pos.klik_pos.utils import get_current_pos_profile


def _get_account_for_mode(mode_of_payment, company):
	"""Resolve Bank/Cash account for a mode of payment in the given company."""
	try:
		from erpnext.accounts.doctype.journal_entry.journal_entry import get_default_bank_cash_account
		return get_default_bank_cash_account(company, mode_of_payment=mode_of_payment) or {}
	except Exception:
		return {}


def _repair_missing_ledger_entries(customer, company):
	"""
	Find submitted Sales Invoices with outstanding > 0 but no Payment Ledger Entries
	and recreate their GL/PLE entries so they become visible to ERPNext's payment system.
	"""
	invoices_with_outstanding = frappe.get_all(
		"Sales Invoice",
		filters={
			"customer": customer,
			"company": company,
			"docstatus": 1,
			"outstanding_amount": [">", 0],
		},
		fields=["name"],
	)
	if not invoices_with_outstanding:
		return

	repaired = False
	for inv in invoices_with_outstanding:
		ple_exists = frappe.db.exists(
			"Payment Ledger Entry",
			{"against_voucher_no": inv.name, "delinked": 0},
		)
		if not ple_exists:
			try:
				doc = frappe.get_doc("Sales Invoice", inv.name)
				doc.make_gl_entries()
				repaired = True
			except Exception:
				frappe.log_error(frappe.get_traceback(), f"Repair GL for {inv.name}")

	if repaired:
		frappe.db.commit()


def _get_ple_outstanding_refs(customer, company):
	"""
	Get outstanding invoice references via ERPNext's PLE-based function.
	Automatically repairs invoices with missing ledger entries before querying.
	"""
	_repair_missing_ledger_entries(customer, company)

	from erpnext.accounts.party import get_party_account
	from erpnext.accounts.doctype.payment_entry.payment_entry import get_outstanding_reference_documents

	paid_from = get_party_account("Customer", customer, company)
	if not paid_from:
		return [], paid_from

	args = {
		"party_type": "Customer",
		"party": customer,
		"company": company,
		"party_account": paid_from,
		"posting_date": getdate(nowdate()),
		"get_outstanding_invoices": True,
	}
	refs = get_outstanding_reference_documents(args, validate=False) or []
	return refs, paid_from


@frappe.whitelist()
def receive_outstanding_prepare(customer, company=None):
	"""
	Return total_outstanding and payment_modes for the Receive Outstanding modal.
	Outstanding is PLE-based so it matches exactly what can be allocated to Payment Entries.
	"""
	try:
		if not customer:
			return {"success": False, "error": _("Customer is required.")}

		if not company:
			pos = get_current_pos_profile()
			company = pos.company if pos else None
		if not company:
			return {"success": False, "error": _("Company is required.")}

		refs, _paid_from = _get_ple_outstanding_refs(customer, company)
		total_outstanding = flt(sum(flt(r.get("outstanding_amount"), 2) for r in refs), 2)

		pos = get_current_pos_profile()
		if not pos:
			return {"success": False, "error": _("No POS profile found.")}

		payment_methods = frappe.get_all(
			"POS Payment Method",
			filters={"parent": pos.name},
			fields=["mode_of_payment", "default"],
		)
		payment_modes = []
		for row in payment_methods:
			mode = row.get("mode_of_payment")
			if not mode:
				continue
			account_info = _get_account_for_mode(mode, company)
			if account_info and account_info.get("account"):
				payment_modes.append({
					"mode_of_payment": mode,
					"account": account_info.get("account"),
					"default": row.get("default"),
				})

		return {
			"success": True,
			"total_outstanding": total_outstanding,
			"payment_modes": payment_modes,
			"company": company,
		}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Receive Outstanding Prepare")
		return {"success": False, "error": str(e)}


@frappe.whitelist()
def receive_outstanding_submit(customer, company=None, payments=None):
	"""
	Create and submit one Payment Entry (Receive) per payment (mode + amount).
	FIFO allocation uses PLE-based outstanding refs so PE validation passes.
	"""
	try:
		if not customer:
			return {"success": False, "error": _("Customer is required.")}

		if not company:
			pos = get_current_pos_profile()
			company = pos.company if pos else None
		if not company:
			return {"success": False, "error": _("Company is required.")}

		if payments is None:
			return {"success": False, "error": _("Payments are required.")}
		if isinstance(payments, str):
			payments = json.loads(payments)
		if not isinstance(payments, list) or len(payments) == 0:
			return {"success": False, "error": _("At least one payment (mode and amount) is required.")}

		total_to_receive = 0
		for p in payments:
			amt = flt(p.get("amount"), 2)
			if amt <= 0:
				return {"success": False, "error": _("Each payment amount must be greater than zero.")}
			total_to_receive += amt

		refs, paid_from = _get_ple_outstanding_refs(customer, company)
		if not paid_from:
			return {"success": False, "error": _("Could not determine receivable account for customer.")}

		allocatable = flt(sum(flt(r.get("outstanding_amount"), 2) for r in refs), 2)
		if total_to_receive > allocatable + 0.01:
			return {
				"success": False,
				"error": _("Total amount ({0}) exceeds allocatable outstanding ({1}). Please refresh and try again.").format(
					total_to_receive, allocatable
				),
			}

		submitted = []
		original_user = frappe.session.user
		opening_entry_name = get_current_pos_opening_entry() or ""

		for pay in payments:
			mode = pay.get("mode_of_payment")
			amount = flt(pay.get("amount"), 2)
			if not mode or amount <= 0:
				continue

			account_info = _get_account_for_mode(mode, company)
			paid_to = account_info.get("account") if account_info else None
			if not paid_to:
				return {"success": False, "error": _("No account found for mode of payment {0}.").format(mode)}

			if len(submitted) > 0:
				frappe.db.commit()
				refs, _ = _get_ple_outstanding_refs(customer, company)

			if not refs:
				return {"success": False, "error": _("No outstanding invoices found.")}

			remaining = amount
			references = []
			for r in refs:
				if remaining <= 0:
					break
				outstanding = flt(r.get("outstanding_amount"), 2)
				if outstanding <= 0:
					continue
				alloc = min(remaining, outstanding)
				references.append({
					"reference_doctype": r.get("voucher_type"),
					"reference_name": r.get("voucher_no"),
					"due_date": r.get("due_date"),
					"total_amount": flt(r.get("invoice_amount"), 2),
					"outstanding_amount": outstanding,
					"allocated_amount": alloc,
					"account": r.get("account"),
					"exchange_rate": flt(r.get("exchange_rate"), 2) or 1,
				})
				remaining -= alloc

			if remaining > 0.01:
				return {"success": False, "error": _("Could not allocate full amount to invoices; outstanding may have changed.")}

			frappe.set_user("Administrator")
			try:
				pe_data = {
					"doctype": "Payment Entry",
					"payment_type": "Receive",
					"party_type": "Customer",
					"party": customer,
					"company": company,
					"posting_date": getdate(nowdate()),
					"paid_from": paid_from,
					"paid_to": paid_to,
					"mode_of_payment": mode,
					"paid_amount": amount,
					"received_amount": amount,
					"source_exchange_rate": 1,
					"target_exchange_rate": 1,
					"references": references,
				}
				if opening_entry_name:
					pe_data["custom_pos_opening_entry"] = opening_entry_name
				pe_data["custom_pos_payment_type"] = "Credit Payment"

				paid_to_type = frappe.get_cached_value("Account", paid_to, "account_type")
				if paid_to_type == "Bank":
					pe_data["reference_no"] = f"POS-RO-{nowdate()}-{mode}-{customer}"
					pe_data["reference_date"] = getdate(nowdate())

				pe = frappe.get_doc(pe_data)
				pe.set_missing_values()
				pe.set_missing_ref_details(force=True)
				pe.insert(ignore_permissions=True)
				pe.submit()

				frappe.db.set_value("Payment Entry", pe.name, {
					"owner": original_user,
					"modified_by": original_user,
				}, update_modified=False)
			finally:
				frappe.set_user(original_user)

			submitted.append({"name": pe.name, "mode_of_payment": mode, "amount": amount})

		# Return PLE-consistent outstanding after all PEs
		post_refs, _ = _get_ple_outstanding_refs(customer, company)
		new_outstanding = flt(sum(flt(r.get("outstanding_amount"), 2) for r in post_refs), 2)

		return {
			"success": True,
			"payment_entries": submitted,
			"total_outstanding": new_outstanding,
		}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Receive Outstanding Submit")
		return {"success": False, "error": str(e)}
