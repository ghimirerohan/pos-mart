import json
import traceback

import frappe
from frappe import _
from frappe.utils import now_datetime, today

# Import for clearing cache
from klik_pos.api.cache import clear_backend_cache
from klik_pos.klik_pos.utils import clear_pos_profile_cache, get_current_pos_profile


@frappe.whitelist()
def open_pos():
	"""Check if the current user has an open POS Opening Entry."""
	user = frappe.session.user

	# Look for any submitted POS Opening Entry with no linked closing entry for this user
	open_entry = frappe.db.exists(
		"POS Opening Entry",
		{
			"user": user,
			"docstatus": 1,
			"pos_closing_entry": None,
			"status": "Open",
		},
	)

	return True if open_entry else False


@frappe.whitelist()
def create_opening_entry():
	"""
	Create a POS Opening Entry with balance details only.
	"""
	try:
		data = frappe.local.form_dict
		if isinstance(data, str):
			data = json.loads(data)

		user = frappe.session.user

		selected_pos_profile = data.get("pos_profile")
		if selected_pos_profile:
			pos_profile = selected_pos_profile
		else:
			pos_profile = get_current_pos_profile().name if get_current_pos_profile() else None

		if not pos_profile:
			frappe.throw(_("POS Profile could not be determined"))

		company = frappe.db.get_value("POS Profile", pos_profile, "company")
		if not company:
			frappe.throw(_("POS Profile {0} has no company configured").format(pos_profile))

		balance_details = data.get("balance_details") or data.get("opening_balance", [])
		if not balance_details:
			frappe.throw(_("At least one balance detail (mode of payment) is required"))

		# Check if an open entry exists
		existing = frappe.db.exists(
			"POS Opening Entry",
			{
				"pos_profile": pos_profile,
				"user": user,
				"docstatus": 1,
				"pos_closing_entry": None,
			},
		)
		if existing:
			frappe.throw(
				_(
					"You already have an open POS Opening Entry for profile '{0}'. Please close the existing entry before creating a new one."
				).format(pos_profile)
			)

		# Create the POS Opening Entry
		doc = frappe.new_doc("POS Opening Entry")
		doc.user = user
		doc.company = company
		doc.pos_profile = pos_profile
		doc.posting_date = today()
		doc.set_posting_time = 1
		doc.period_start_date = now_datetime()

		for row in balance_details:
			doc.append(
				"balance_details",
				{
					"mode_of_payment": row.get("mode_of_payment"),
					"opening_amount": row.get("opening_amount"),
				},
			)

		doc.insert()
		doc.submit()

		# Clear POS profile cache after creating opening entry to ensure fresh data
		try:
			clear_pos_profile_cache(user=user)
			frappe.logger().info(
				f"🧹 POS Profile cache cleared after creating opening entry for user: {user}"
			)
		except Exception:
			# Do not block opening if cache clear fails; log and continue
			frappe.logger().warning(
				f"Failed to clear POS profile cache after opening entry: {frappe.get_traceback()}"
			)

		return {
			"name": doc.name,
			"message": _("POS Opening Entry created successfully."),
		}

	except Exception as e:
		# Log error with full traceback in Error Log
		frappe.log_error(message=traceback.format_exc(), title="POS Opening Entry Creation Failed")
		# Throw user-friendly message
		frappe.throw(_("Failed to create POS Opening Entry: {0}").format(str(e)))


def validate_opening_entry(doc, method):
	exists = frappe.db.exists(
		"POS Opening Entry",
		{
			"user": doc.user,
			"status": "Open",
		},
	)
	if exists:
		cashier_name = frappe.db.get_value("User", doc.user, "full_name") or doc.user
		frappe.throw(_("Cashier {0} already has an open entry: {1}").format(cashier_name, exists))


@frappe.whitelist()
def create_closing_entry():
	"""
	Create a POS Closing Entry for the current user's open POS Opening Entry.
	"""
	try:
		data = _parse_request_data()
		user = frappe.session.user
		frappe.logger().info(f"POS Closing Entry Data Received: {data}")

		opening_entry = _get_open_pos_entry(user)
		payment_data = _calculate_payment_reconciliation(opening_entry, data)

		doc = _create_and_submit_closing_doc(opening_entry, data, payment_data, user)

		return {
			"name": doc.name,
			"message": _("POS Closing Entry created successfully."),
		}

	except Exception as e:
		frappe.log_error(message=traceback.format_exc(), title="POS Closing Entry Creation Failed")
		frappe.throw(_("Failed to create POS Closing Entry: {0}").format(str(e)))


def _parse_request_data():
	"""Parse and normalize the incoming request data."""
	data = frappe.local.form_dict
	if isinstance(data, str):
		data = json.loads(data)

	# Normalize closing_balance format and exclude Credit (not a real Mode of Payment)
	closing_balance_raw = data.get("closing_balance", {})
	closing_balance = {}

	if isinstance(closing_balance_raw, list):
		for item in closing_balance_raw:
			if isinstance(item, dict) and "mode_of_payment" in item and "closing_amount" in item:
				if item["mode_of_payment"] != "Credit":
					closing_balance[item["mode_of_payment"]] = item["closing_amount"]
	elif isinstance(closing_balance_raw, dict):
		closing_balance = {k: v for k, v in closing_balance_raw.items() if k != "Credit"}

	data["closing_balance"] = closing_balance

	# Parse total_credit_given
	data["total_credit_given"] = float(data.get("total_credit_given", 0) or 0)

	return data


def _get_open_pos_entry(user):
	"""Fetch and validate the open POS Opening Entry for the user."""
	open_entry = frappe.get_all(
		"POS Opening Entry",
		filters={"user": user, "docstatus": 1, "status": "Open"},
		fields=["name", "pos_profile", "company", "period_start_date"],
	)

	if not open_entry:
		frappe.throw(_("No open POS Opening Entry found for user."))

	return open_entry[0]


def _calculate_payment_reconciliation(opening_entry, data):
	"""
	Calculate payment reconciliation data including opening balances,
	sales amounts, Payment Entry amounts (credit payments), and expected vs closing amounts.
	
	This comprehensive reconciliation includes:
	- Opening balances from POS Opening Entry
	- Sales payments from Sales Invoice Payment (IN)
	- Return payments from Sales Invoice Payment (OUT)
	- Payment Entries for credit payments received (IN)
	"""
	opening_entry_name = opening_entry.name
	opening_start = opening_entry.period_start_date
	opening_date = opening_start.date()
	opening_time = opening_start.time().strftime("%H:%M:%S")

	# Fetch opening balances
	opening_modes = frappe.get_all(
		"POS Opening Entry Detail",
		filters={"parent": opening_entry_name},
		fields=["mode_of_payment", "opening_amount"],
	)
	opening_balance_map = {row.mode_of_payment: row.opening_amount for row in opening_modes}

	# Aggregate sales payments by payment mode (IN - regular sales)
	sales_in_data = frappe.db.sql(
		"""
		SELECT sip.mode_of_payment,
		       SUM(sip.amount) as total_amount,
		       COUNT(DISTINCT si.name) as transactions
		FROM `tabSales Invoice` si
		JOIN `tabSales Invoice Payment` sip ON si.name = sip.parent
		WHERE si.pos_profile = %s
		  AND si.docstatus = 1
		  AND si.posting_date = %s
		  AND si.posting_time >= %s
		  AND si.is_return = 0
		  AND si.custom_pos_opening_entry IS NOT NULL
		  AND si.custom_pos_opening_entry != ''
		GROUP BY sip.mode_of_payment
		""",
		(opening_entry.pos_profile, opening_date, opening_time),
		as_dict=True,
	)
	sales_in_map = {row.mode_of_payment: float(row.total_amount or 0) for row in sales_in_data}

	# Aggregate return payments by payment mode (OUT - refunds)
	returns_out_data = frappe.db.sql(
		"""
		SELECT sip.mode_of_payment,
		       SUM(ABS(sip.amount)) as total_amount,
		       COUNT(DISTINCT si.name) as transactions
		FROM `tabSales Invoice` si
		JOIN `tabSales Invoice Payment` sip ON si.name = sip.parent
		WHERE si.pos_profile = %s
		  AND si.docstatus = 1
		  AND si.posting_date = %s
		  AND si.posting_time >= %s
		  AND si.is_return = 1
		  AND si.custom_pos_opening_entry IS NOT NULL
		  AND si.custom_pos_opening_entry != ''
		GROUP BY sip.mode_of_payment
		""",
		(opening_entry.pos_profile, opening_date, opening_time),
		as_dict=True,
	)
	returns_out_map = {row.mode_of_payment: float(row.total_amount or 0) for row in returns_out_data}

	# Aggregate Payment Entries (credit payments received) - IN
	# Match entries linked to the opening entry OR by the same user without a link
	pe_meta = frappe.get_meta("Payment Entry")
	has_pos_opening_field = pe_meta.has_field("custom_pos_opening_entry")
	
	payment_entries_in_map = {}
	if has_pos_opening_field:
		pe_data = frappe.db.sql(
			"""
			SELECT pe.mode_of_payment,
			       SUM(pe.paid_amount) as total_amount,
			       COUNT(DISTINCT pe.name) as transactions
			FROM `tabPayment Entry` pe
			WHERE pe.docstatus = 1
			  AND pe.party_type = 'Customer'
			  AND pe.payment_type = 'Receive'
			  AND (pe.custom_pos_opening_entry = %s
			       OR (pe.owner = %s AND pe.posting_date = %s
			           AND (pe.custom_pos_opening_entry IS NULL OR pe.custom_pos_opening_entry = '')))
			GROUP BY pe.mode_of_payment
			""",
			(opening_entry_name, frappe.session.user, opening_date),
			as_dict=True,
		)
	else:
		pe_data = frappe.db.sql(
			"""
			SELECT pe.mode_of_payment,
			       SUM(pe.paid_amount) as total_amount,
			       COUNT(DISTINCT pe.name) as transactions
			FROM `tabPayment Entry` pe
			WHERE pe.docstatus = 1
			  AND pe.posting_date = %s
			  AND pe.party_type = 'Customer'
			  AND pe.payment_type = 'Receive'
			  AND pe.owner = %s
			GROUP BY pe.mode_of_payment
			""",
			(opening_date, frappe.session.user),
			as_dict=True,
		)
	
	payment_entries_in_map = {row.mode_of_payment: float(row.total_amount or 0) for row in pe_data}

	# Build reconciliation entries (only real payment modes, not "Credit")
	closing_balance = data.get("closing_balance", {})
	reconciliation = []

	# Collect all payment modes from all sources
	all_modes = set(opening_balance_map.keys())
	all_modes.update(sales_in_map.keys())
	all_modes.update(returns_out_map.keys())
	all_modes.update(payment_entries_in_map.keys())
	all_modes.update(closing_balance.keys())
	all_modes.discard("Credit")

	for mode in all_modes:
		opening_amount = float(opening_balance_map.get(mode, 0))
		sales_in = float(sales_in_map.get(mode, 0))
		returns_out = float(returns_out_map.get(mode, 0))
		pe_in = float(payment_entries_in_map.get(mode, 0))
		
		expected_amount = opening_amount + sales_in + pe_in - returns_out
		
		closing_amount = float(closing_balance.get(mode, 0))
		difference = closing_amount - expected_amount

		reconciliation.append(
			{
				"mode_of_payment": mode,
				"opening_amount": opening_amount,
				"expected_amount": expected_amount,
				"closing_amount": closing_amount,
				"difference": difference,
			}
		)

	return reconciliation


def _calculate_closing_entry_totals(opening_entry_name):
	"""
	Calculate total_quantity, net_total, and grand_total from all Sales Invoices
	linked to the opening entry. This matches standard Frappe POS behavior.
	"""
	from frappe.utils import flt

	try:
		# Aggregate all totals in a single efficient SQL query
		aggregated = frappe.db.sql(
			"""
			SELECT
				COALESCE(SUM(si.net_total), 0) as net_total,
				COALESCE(SUM(si.grand_total), 0) as grand_total,
				COALESCE(SUM(sii.qty), 0) as total_quantity
			FROM `tabSales Invoice` si
			LEFT JOIN `tabSales Invoice Item` sii ON si.name = sii.parent
			WHERE si.custom_pos_opening_entry = %s
			  AND si.docstatus = 1
			""",
			(opening_entry_name,),
			as_dict=True,
		)

		if aggregated and len(aggregated) > 0:
			net_total = flt(aggregated[0].net_total or 0)
			grand_total = flt(aggregated[0].grand_total or 0)
			total_quantity = flt(aggregated[0].total_quantity or 0)
		else:
			net_total = grand_total = total_quantity = 0.0

		return {
			"total_quantity": total_quantity,
			"net_total": net_total,
			"grand_total": grand_total,
		}
	except Exception as e:
		frappe.logger().error(f"Error calculating closing entry totals: {frappe.get_traceback()}")
		frappe.log_error(
			message=f"Error calculating totals: {e!s}\n{traceback.format_exc()}",
			title="Closing Entry Totals Calculation Error",
		)
		# Return zeros on error to avoid blocking closing entry creation
		return {"total_quantity": 0.0, "net_total": 0.0, "grand_total": 0.0}


def _populate_sales_invoices_to_closing_entry(closing_doc, opening_entry_name):
	"""
	Populate the custom_sales_invoice child table with all Sales Invoices
	linked to the opening entry.
	"""
	try:
		# Fetch all submitted Sales Invoices linked to this opening entry
		invoices = frappe.get_all(
			"Sales Invoice",
			filters={
				"custom_pos_opening_entry": opening_entry_name,
				"docstatus": 1,  # Only submitted invoices
			},
			fields=["name", "customer", "posting_date", "grand_total"],
			order_by="posting_date, posting_time",
		)

		# Append each invoice to the child table
		for invoice in invoices:
			closing_doc.append(
				"custom_sales_invoice",
				{
					"sales_invoice": invoice.name,
					"customer": invoice.customer,
					"posting_date": invoice.posting_date,
					"amount": invoice.grand_total,
				},
			)

		if invoices:
			frappe.logger().info(
				f"✅ Populated {len(invoices)} sales invoices to closing entry {closing_doc.name}"
			)
	except Exception as e:
		# Log error but don't block closing entry creation
		frappe.logger().error(f"Failed to populate sales invoices to closing entry: {frappe.get_traceback()}")
		frappe.log_error(
			message=f"Error populating sales invoices: {e!s}\n{traceback.format_exc()}",
			title="Sales Invoice Population Error",
		)


def _create_and_submit_closing_doc(opening_entry, data, payment_data, user):
	"""Create, populate, and submit the POS Closing Entry document."""
	doc = frappe.new_doc("POS Closing Entry")
	doc.user = user
	doc.company = opening_entry.company
	doc.pos_profile = opening_entry.pos_profile
	doc.period_start_date = opening_entry.period_start_date
	doc.period_end_date = now_datetime()
	doc.set_posting_time = 1
	doc.posting_date = today()
	doc.pos_opening_entry = opening_entry.name

	# Calculate totals from Sales Invoices linked to opening entry
	totals = _calculate_closing_entry_totals(opening_entry.name)

	# Set totals (use calculated values, fallback to frontend data if calculation fails)
	doc.total_quantity = totals.get("total_quantity") or data.get("total_quantity") or 0.0
	doc.net_total = totals.get("net_total") or data.get("net_total") or 0.0
	doc.total_amount = totals.get("grand_total") or data.get("total_amount") or 0.0
	doc.grand_total = totals.get("grand_total") or data.get("total_amount") or 0.0

	# Append payment reconciliation
	for payment in payment_data:
		doc.append("payment_reconciliation", payment)

	# Append taxes
	for tax in data.get("taxes", []):
		doc.append(
			"taxes",
			{
				"account_head": tax.get("account_head"),
				"rate": tax.get("rate"),
				"amount": tax.get("amount"),
			},
		)

	# Set total credit given for this session
	doc.custom_total_credit_given = float(data.get("total_credit_given", 0) or 0)

	# Populate sales invoices linked to this opening entry
	_populate_sales_invoices_to_closing_entry(doc, opening_entry.name)

	# Insert first, then submit to avoid silent failures
	doc.insert()
	doc.submit()
	frappe.db.set_value("POS Opening Entry", opening_entry.name, "pos_closing_entry", doc.name)

	# Clear POS profile cache for the current user to ensure fresh data on next session
	try:
		clear_pos_profile_cache(user=user)
	except Exception:
		# Do not block closing if cache clear fails; log and continue
		frappe.logger().warning("Failed to clear POS profile cache after closing entry", exc_info=True)

	return doc
