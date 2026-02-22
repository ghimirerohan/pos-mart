import json

import erpnext
import frappe
from erpnext.accounts.doctype.sales_invoice.sales_invoice import SalesInvoice
from frappe import _
from frappe.utils import flt, getdate

from klik_pos.klik_pos.utils import get_current_pos_profile

# Performance optimization: Cache frequently accessed data
_cached_company_data = {}
_cached_customer_data = {}
_cached_item_accounts = {}


def _patch_expired_batch_bypass(doc):
	"""Replace validate_serialized_batch on *doc* to skip the expired-batch
	check while keeping all other serial/batch validations."""
	from erpnext.stock.doctype.serial_no.serial_no import get_serial_nos

	doc._orig_validate_serialized_batch = doc.validate_serialized_batch

	def _validate_without_expiry_check():
		for d in doc.get("items"):
			if hasattr(d, "serial_no") and hasattr(d, "batch_no") and d.serial_no and d.batch_no:
				serial_nos = frappe.get_all(
					"Serial No",
					fields=["batch_no", "name", "warehouse"],
					filters={"name": ("in", get_serial_nos(d.serial_no))},
				)
				for row in serial_nos:
					if row.warehouse and row.batch_no != d.batch_no:
						frappe.throw(
							_("Row #{0}: Serial No {1} does not belong to Batch {2}").format(
								d.idx, row.name, d.batch_no
							)
						)

	doc.validate_serialized_batch = _validate_without_expiry_check


def _unpatch_expired_batch_bypass(doc):
	"""Restore original validate_serialized_batch."""
	orig = getattr(doc, "_orig_validate_serialized_batch", None)
	if orig:
		doc.validate_serialized_batch = orig


def get_current_pos_opening_entry():
	"""
	Get the latest active POS Opening Entry for the current user across ALL profiles.
	Returns the opening entry name or None if not found.
	"""
	try:
		user = frappe.session.user
		opening_entries = frappe.get_all(
			"POS Opening Entry",
			filters={"user": user, "docstatus": 1, "status": "Open"},
			fields=["name"],
			order_by="creation desc",
			limit_page_length=1,
		)

		if opening_entries:
			return opening_entries[0].name
		return None
	except Exception as e:
		frappe.log_error(f"Error getting current POS opening entry: {e!s}")
		return None


@frappe.whitelist(allow_guest=True)
def get_sales_invoices(limit=100, start=0, search="", skip_opening_entry_filter=False, cashier_name=None):
	"""
	Get sales invoices with proper filtering based on user role and POS opening entry.

	Args:
		skip_opening_entry_filter: If True, skip filtering by opening entry (for Invoice History page)
		cashier_name: Filter by cashier name (full name). If provided, only returns invoices for that cashier.
	"""
	try:
		# Convert string to boolean if needed (Frappe passes query params as strings)
		if isinstance(skip_opening_entry_filter, str):
			skip_opening_entry_filter = skip_opening_entry_filter.lower() in ("true", "1", "yes")

		# Get user IDs for cashier filter if cashier_name is provided
		cashier_user_ids = None
		if cashier_name and cashier_name != "all":
			cashier_user_ids = _get_user_ids_by_full_name(cashier_name)
			if not cashier_user_ids:
				# No users found with this name, return empty result
				return {"success": True, "data": [], "total_count": 0}

		filters, fields = _build_filters_and_fields(
			skip_opening_entry_filter=skip_opening_entry_filter, cashier_user_ids=cashier_user_ids
		)

		# Build search filters
		or_filters = _build_search_filters(search)

		invoices = frappe.get_all(
			"Sales Invoice",
			filters=filters,
			or_filters=or_filters,
			fields=fields,
			order_by="modified desc",
			limit=limit,
			start=start,
		)

		count_rows = frappe.get_all(
			"Sales Invoice", filters=filters, or_filters=or_filters, fields=["count(name) as total"]
		)
		total_count = count_rows[0].total if count_rows else 0

		# Batch fetch related data
		invoice_names = [inv.name for inv in invoices]
		user_ids = list(set([inv.owner for inv in invoices]))

		cashier_names_map = _batch_fetch_cashier_names(user_ids)
		payment_methods_map = _batch_fetch_payment_methods(invoice_names)
		items_map = _batch_fetch_items(invoice_names)

		# Process and enrich invoices
		_process_invoices(invoices, cashier_names_map, payment_methods_map, items_map)

		return {"success": True, "data": invoices, "total_count": total_count}

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Error fetching sales invoices")
		return {"success": False, "error": str(e)}


def _get_user_ids_by_full_name(full_name):
	"""Get user IDs (emails) that match the given full name."""
	try:
		users = frappe.get_all(
			"User",
			filters={"full_name": full_name, "enabled": 1},
			fields=["name"],
		)
		return [user.name for user in users] if users else []
	except Exception as e:
		frappe.logger().error(f"Error getting user IDs by full name '{full_name}': {e}")
		return []


def _build_filters_and_fields(skip_opening_entry_filter=False, cashier_user_ids=None):
	"""Build filters and fields list based on user role and metadata.

	Args:
		skip_opening_entry_filter: If True, skip filtering by opening entry (show all invoices)
		cashier_user_ids: List of user IDs to filter by. If provided, only returns invoices for these users.
	"""
	current_opening_entry = get_current_pos_opening_entry()

	# Check if user is admin
	user_roles = frappe.get_roles()
	is_admin_user = "Administrator" in user_roles or "System Manager" in user_roles

	# Skip opening entry filter if requested (for Invoice History page - show all invoices for cashier)
	if skip_opening_entry_filter:
		frappe.logger().info(
			f"Skipping opening entry filter - showing all invoices for user {frappe.session.user}"
		)
		# Don't filter by opening entry - show all invoices
		filters = {}
	elif is_admin_user:
		frappe.logger().info(
			f"Admin user {frappe.session.user} with roles {user_roles} - showing all POS invoices"
		)
		filters = {"custom_pos_opening_entry": ["!=", ""]}
	elif current_opening_entry:
		filters = {"custom_pos_opening_entry": current_opening_entry}
	else:
		frappe.logger().info("No active POS opening entry found, showing all POS invoices")
		filters = {"custom_pos_opening_entry": ["!=", ""]}

	# Check if ZATCA status field exists
	sales_invoice_meta = frappe.get_meta("Sales Invoice")
	has_zatca_status = any(df.fieldname == "custom_zatca_submit_status" for df in sales_invoice_meta.fields)

	# Build fields list
	fields = [
		"name",
		"posting_date",
		"posting_time",
		"owner",
		"customer",
		"customer_name",
		"base_grand_total",
		"grand_total",
		"base_rounded_total",
		"status",
		"discount_amount",
		"total_taxes_and_charges",
		"custom_pos_opening_entry",
		"pos_profile",
		"currency",
		"paid_amount",
		"outstanding_amount",
		"is_return",
		"return_against",
	]

	if has_zatca_status:
		fields.append("custom_zatca_submit_status")

	# Add cashier filter if provided
	if cashier_user_ids:
		if len(cashier_user_ids) == 1:
			filters["owner"] = cashier_user_ids[0]
		else:
			filters["owner"] = ["in", cashier_user_ids]
		frappe.logger().info(f"Filtering by cashier user IDs: {cashier_user_ids}")

	return filters, fields


def _build_search_filters(search):
	"""Build OR filters for search functionality."""
	if not search or not search.strip():
		return None

	search_term = search.strip()
	return [
		["name", "like", f"%{search_term}%"],
		["customer_name", "like", f"%{search_term}%"],
		["customer", "like", f"%{search_term}%"],
	]


def _batch_fetch_cashier_names(user_ids):
	"""Batch fetch cashier names for given user IDs."""
	if not user_ids:
		return {}

	placeholders = ",".join(["%s"] * len(user_ids))
	cashier_query = f"""
		SELECT name, full_name
		FROM `tabUser`
		WHERE name IN ({placeholders})
	"""
	cashier_results = frappe.db.sql(cashier_query, tuple(user_ids), as_dict=True)
	return {user.name: user.full_name or user.name for user in cashier_results}


def _batch_fetch_payment_methods(invoice_names):
	"""Batch fetch payment methods for given invoices from both child table and Payment Entry references."""
	if not invoice_names:
		return {}

	# First, fetch from Sales Invoice Payment child table (for POS invoices paid at checkout)
	placeholders = ",".join(["%s"] * len(invoice_names))
	payment_query = f"""
		SELECT parent, mode_of_payment, amount
		FROM `tabSales Invoice Payment`
		WHERE parent IN ({placeholders})
	"""
	payment_results = frappe.db.sql(payment_query, tuple(invoice_names), as_dict=True)

	# Group by parent invoice
	payment_methods_map = {}
	for payment in payment_results:
		if payment.parent not in payment_methods_map:
			payment_methods_map[payment.parent] = []
		payment_methods_map[payment.parent].append(
			{"mode_of_payment": payment.mode_of_payment, "amount": payment.amount}
		)

	# Find invoices that don't have payment methods in the child table
	# These might have been paid later via Payment Entry (e.g., credit sales paid later)
	invoices_without_child_payments = [name for name in invoice_names if name not in payment_methods_map]

	if invoices_without_child_payments:
		# Fetch payment methods from Payment Entry references for these invoices
		pe_placeholders = ",".join(["%s"] * len(invoices_without_child_payments))
		pe_query = f"""
			SELECT per.reference_name as parent, pe.mode_of_payment, per.allocated_amount as amount
			FROM `tabPayment Entry Reference` per
			JOIN `tabPayment Entry` pe ON pe.name = per.parent
			WHERE per.reference_doctype = 'Sales Invoice'
			AND per.reference_name IN ({pe_placeholders})
			AND pe.docstatus = 1
		"""
		pe_results = frappe.db.sql(pe_query, tuple(invoices_without_child_payments), as_dict=True)

		for payment in pe_results:
			if payment.parent not in payment_methods_map:
				payment_methods_map[payment.parent] = []
			payment_methods_map[payment.parent].append(
				{"mode_of_payment": payment.mode_of_payment, "amount": payment.amount}
			)

	return payment_methods_map


def _batch_fetch_items(invoice_names):
	"""Batch fetch items for given invoices."""
	if not invoice_names:
		return {}

	placeholders = ",".join(["%s"] * len(invoice_names))
	items_query = f"""
		SELECT parent, item_code, qty, rate, amount
		FROM `tabSales Invoice Item`
		WHERE parent IN ({placeholders})
	"""
	items_results = frappe.db.sql(items_query, tuple(invoice_names), as_dict=True)

	# Group by parent invoice
	items_map = {}
	for item in items_results:
		if item.parent not in items_map:
			items_map[item.parent] = []
		items_map[item.parent].append(
			{
				"item_code": item.item_code,
				"qty": item.qty,
				"rate": item.rate,
				"amount": item.amount,
				"quantity": item.qty,
			}
		)

	return items_map


def _process_invoices(invoices, cashier_names_map, payment_methods_map, items_map):
	"""Process and enrich invoices with related data."""
	# Define unpaid statuses - invoices with these statuses and no payment methods should show "Credit"
	unpaid_statuses = {"Unpaid", "Overdue", "Partly Paid", "Pending", "Draft"}

	for inv in invoices:
		# Set cashier name
		inv["cashier_name"] = cashier_names_map.get(inv.owner, inv.owner)

		# Format posting_time
		if inv.get("posting_time"):
			if hasattr(inv["posting_time"], "total_seconds"):
				total_seconds = int(inv["posting_time"].total_seconds())
				hours = total_seconds // 3600
				minutes = (total_seconds % 3600) // 60
				seconds = total_seconds % 60
				inv["posting_time"] = f"{hours:02d}:{minutes:02d}:{seconds:02d}"
			else:
				inv["posting_time"] = str(inv["posting_time"])

		# Set payment methods
		payment_methods = payment_methods_map.get(inv.name, [])
		inv["payment_methods"] = payment_methods

		# Set backward-compatible mode_of_payment field
		# Logic: 
		# - If no payment methods and invoice is unpaid/overdue/pending → show "Credit"
		# - If no payment methods and invoice is paid → should have been fetched from Payment Entry, but fallback to "-"
		# - If payment methods exist → show the payment method(s)
		if len(payment_methods) == 0:
			invoice_status = inv.get("status", "")
			if invoice_status in unpaid_statuses:
				inv["mode_of_payment"] = "Credit"
			else:
				# Paid invoice without any payment methods found (edge case) - show "-"
				inv["mode_of_payment"] = "-"
		elif len(payment_methods) == 1:
			inv["mode_of_payment"] = payment_methods[0]["mode_of_payment"]
		else:
			inv["mode_of_payment"] = "/".join([pm["mode_of_payment"] for pm in payment_methods])

		# Set items and calculate return data
		items = items_map.get(inv.name, [])

		# Only calculate return data for Credit Note Issued invoices
		if inv.get("status") == "Credit Note Issued":
			_calculate_return_quantities(inv, items)
		else:
			for item in items:
				item["returned_qty"] = 0
				item["available_qty"] = item["qty"]

		inv["items"] = items


def _calculate_return_quantities(invoice, items):
	"""Calculate return quantities for credit note invoices."""
	item_codes = [item["item_code"] for item in items]
	if not item_codes:
		return

	item_placeholders = ",".join(["%s"] * len(item_codes))
	returns_query = f"""
		SELECT sii.item_code, COALESCE(SUM(ABS(sii.qty)), 0) as total_returned_qty
		FROM `tabSales Invoice` si
		JOIN `tabSales Invoice Item` sii ON si.name = sii.parent
		WHERE si.is_return = 1
		  AND si.return_against = %s
		  AND sii.item_code IN ({item_placeholders})
		  AND si.docstatus = 1
		  AND si.customer = %s
		GROUP BY sii.item_code
	"""
	returns_data = frappe.db.sql(returns_query, (invoice.name, *item_codes, invoice.customer), as_dict=True)
	returned_qty_map = {row.item_code: row.total_returned_qty for row in returns_data}

	# Update items with return data
	for item in items:
		returned_qty_value = returned_qty_map.get(item["item_code"], 0)
		item["returned_qty"] = round(float(returned_qty_value), 6)
		item["available_qty"] = round(item["qty"] - returned_qty_value, 6)


@frappe.whitelist(allow_guest=True)
def get_invoice_details(invoice_id):
	"""
	Main function to fetch complete invoice details.
	"""
	try:
		invoice = frappe.get_doc("Sales Invoice", invoice_id)
		invoice_data = invoice.as_dict()

		# Get items with return data
		items = _get_invoice_items_with_returns(invoice_id, invoice.customer)

		# Get address and customer information
		address_data = _get_address_and_customer_info(invoice)

		# Format posting time
		if invoice_data.get("posting_time"):
			if hasattr(invoice_data["posting_time"], "total_seconds"):
				total_seconds = int(invoice_data["posting_time"].total_seconds())
				hours = total_seconds // 3600
				minutes = (total_seconds % 3600) // 60
				seconds = total_seconds % 60
				invoice_data["posting_time"] = f"{hours:02d}:{minutes:02d}:{seconds:02d}"
			else:
				invoice_data["posting_time"] = str(invoice_data["posting_time"])

		# Get cashier full name
		cashier_name = frappe.db.get_value(
			"User", invoice_data.get("owner"), "full_name"
		) or invoice_data.get("owner")
		invoice_data["cashier_name"] = cashier_name

		# Get payment methods and set paymentMethod field
		payment_methods = []
		
		# First check payments child table (for POS invoices paid at checkout)
		if invoice.payments:
			for payment in invoice.payments:
				payment_methods.append(
					{"mode_of_payment": payment.mode_of_payment, "amount": payment.amount}
				)
		
		# If no payments in child table, check Payment Entry references (for later payments)
		if not payment_methods:
			payment_entries = frappe.get_all(
				"Payment Entry Reference",
				filters={"reference_name": invoice_id, "reference_doctype": "Sales Invoice"},
				fields=["parent", "allocated_amount"],
			)
			for pe_ref in payment_entries:
				pe_doc = frappe.get_doc("Payment Entry", pe_ref.parent)
				if pe_doc.docstatus == 1:
					payment_methods.append(
						{"mode_of_payment": pe_doc.mode_of_payment, "amount": pe_ref.allocated_amount}
					)
		
		invoice_data["payment_methods"] = payment_methods
		
		# Set paymentMethod field based on payment methods and invoice status
		# Logic: 
		# - If no payment methods and invoice is unpaid/overdue/pending → show "Credit"
		# - If no payment methods and invoice is paid → show "-" (edge case)
		# - If payment methods exist → show the payment method(s)
		unpaid_statuses = {"Unpaid", "Overdue", "Partly Paid", "Pending", "Draft"}
		if len(payment_methods) == 0:
			if invoice.status in unpaid_statuses:
				invoice_data["paymentMethod"] = "Credit"
			else:
				invoice_data["paymentMethod"] = "-"
		elif len(payment_methods) == 1:
			invoice_data["paymentMethod"] = payment_methods[0]["mode_of_payment"]
		else:
			invoice_data["paymentMethod"] = "/".join([pm["mode_of_payment"] for pm in payment_methods])

		return {
			"success": True,
			"data": {
				**invoice_data,
				"items": items,
				**address_data,
			},
		}

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"Error fetching invoice {invoice_id}")
		return {"success": False, "error": str(e)}


def _get_invoice_items_with_returns(invoice_id, customer):
	"""
	Fetch invoice items and calculate returned/available quantities.
	"""
	# Batch fetch all items for this invoice
	items_query = """
		SELECT item_code, item_name, qty, rate, amount, description
		FROM `tabSales Invoice Item`
		WHERE parent = %s
	"""
	items_data = frappe.db.sql(items_query, (invoice_id,), as_dict=True)

	# Batch fetch return quantities for all items at once
	item_codes = [item.item_code for item in items_data]
	returned_qty_map = {}

	if item_codes:
		item_placeholders = ",".join(["%s"] * len(item_codes))
		returns_query = f"""
			SELECT sii.item_code, COALESCE(SUM(ABS(sii.qty)), 0) as total_returned_qty
			FROM `tabSales Invoice` si
			JOIN `tabSales Invoice Item` sii ON si.name = sii.parent
			WHERE si.is_return = 1
			  AND si.return_against = %s
			  AND sii.item_code IN ({item_placeholders})
			  AND si.docstatus = 1
			  AND si.customer = %s
			GROUP BY sii.item_code
		"""
		returns_data = frappe.db.sql(returns_query, (invoice_id, *item_codes, customer), as_dict=True)
		returned_qty_map = {row.item_code: row.total_returned_qty for row in returns_data}

	# Build items list with return data
	items = []
	for item in items_data:
		returned_qty_value = returned_qty_map.get(item.item_code, 0)
		available_qty = round(item.qty - returned_qty_value, 6)

		items.append(
			{
				"item_code": item.item_code,
				"item_name": item.item_name,
				"qty": item.qty,
				"rate": item.rate,
				"amount": item.amount,
				"description": item.description,
				"returned_qty": returned_qty_value,
				"available_qty": available_qty,
			}
		)

	return items


def _get_address_and_customer_info(invoice):
	"""
	Fetch company address, customer address, and customer contact information.
	"""
	# Get company address
	company_address_doc = None
	if invoice.company_address:
		company_address_doc = frappe.get_doc("Address", invoice.company_address).as_dict()

	# Get customer address
	customer_address_doc = None
	if invoice.customer_address:
		customer_address_doc = frappe.get_doc("Address", invoice.customer_address).as_dict()
	else:
		primary_address = frappe.db.get_value(
			"Dynamic Link",
			{
				"link_doctype": "Customer",
				"link_name": invoice.customer,
				"parenttype": "Address",
			},
			"parent",
		)
		if primary_address:
			customer_address_doc = frappe.get_doc("Address", primary_address).as_dict()

	# Get customer contact information
	customer_email = ""
	customer_mobile_no = ""
	customer_address_line1 = ""
	customer_city = ""
	customer_state = ""
	customer_pincode = ""
	customer_country = ""

	if invoice.customer:
		customer_doc = frappe.get_doc("Customer", invoice.customer)
		customer_email = customer_doc.email_id or ""
		customer_mobile_no = customer_doc.mobile_no or ""

		# Extract address fields
		if customer_address_doc:
			customer_address_line1 = customer_address_doc.get("address_line1", "")
			customer_city = customer_address_doc.get("city", "")
			customer_state = customer_address_doc.get("state", "")
			customer_pincode = customer_address_doc.get("pincode", "")
			customer_country = customer_address_doc.get("country", "")

	return {
		"company_address_doc": company_address_doc,
		"customer_address_doc": customer_address_doc,
		"customer_email": customer_email,
		"customer_mobile_no": customer_mobile_no,
		"customer_address_line1": customer_address_line1,
		"customer_city": customer_city,
		"customer_state": customer_state,
		"customer_pincode": customer_pincode,
		"customer_country": customer_country,
	}


@frappe.whitelist()
def create_and_submit_invoice(data):
	try:
		import time

		start_time = time.time()

		# Validate input data
		if not data:
			frappe.throw("No data provided for invoice creation")

		(
			customer,
			items,
			amount_paid,
			sales_and_tax_charges,
			mode_of_payment,
			business_type,
			roundoff_amount,
			delivery_personnel,
			is_credit_sale,
			is_partial_payment,
			partial_payment_amount,
			outstanding_amount,
		) = parse_invoice_data(data)

		# Validate required fields
		if not customer:
			frappe.throw("Customer is required")
		if not items or len(items) == 0:
			frappe.throw("At least one item is required")
		
		# Validate customer exists and is valid
		try:
			customer_doc = frappe.get_doc("Customer", customer)
			if not customer_doc:
				frappe.throw(f"Customer '{customer}' not found")
		except frappe.DoesNotExistError:
			frappe.throw(f"Customer '{customer}' does not exist")
		except Exception as e:
			frappe.throw(f"Error validating customer: {str(e)}")

		# Pre-validate stock availability before building the invoice
		_validate_stock_availability(items)

		# Build invoice document
		# For credit sale: don't include payment entries - let ERPNext handle it naturally (outstanding = grand_total)
		# For partial payment: don't include payment entries in child table - we'll create a separate Payment Entry
		# For normal payment: include payment entries in child table
		include_payments = not is_credit_sale and not is_partial_payment
		
		doc = build_sales_invoice_doc(
			customer,
			items,
			amount_paid,
			sales_and_tax_charges,
			mode_of_payment if include_payments else None,  # Only add payment entries for normal payments
			business_type,
			roundoff_amount,
			include_payments=include_payments,
			delivery_personnel=delivery_personnel,
			is_credit_sale=is_credit_sale,
			is_partial_payment=is_partial_payment,
		)

		# Ensure totals are calculated before accessing them
		# ERPNext should calculate these automatically, but ensure they're set
		try:
			doc.run_method("calculate_taxes_and_totals")
		except Exception:
			# If calculation fails, try to trigger it differently
			doc.flags.ignore_validate = True
			doc.run_method("set_missing_values")
			doc.run_method("calculate_taxes_and_totals")

		# For credit sale: Let ERPNext handle outstanding amount automatically (no payment entries = full outstanding)
		# For partial payment: Set paid_amount to partial amount, outstanding_amount = grand_total - paid_amount
		# For normal payment: Calculate paid amounts from payment entries
		if is_credit_sale:
			# Credit sale: No payment entries, so paid_amount = 0, outstanding_amount = grand_total
			# ERPNext will set this automatically, but we ensure it's correct
			doc.paid_amount = 0.0
			doc.base_paid_amount = 0.0
			# Outstanding amount will be calculated automatically by ERPNext as grand_total - paid_amount
		elif is_partial_payment:
			# Partial payment: For non-POS invoices (is_pos=0), ERPNext uses Payment Entries
			# not the payments child table. We'll create a Payment Entry after invoice submission.
			# Set paid_amount to 0 initially - it will be updated by the Payment Entry
			doc.paid_amount = 0.0
			doc.base_paid_amount = 0.0
			# Clear payments child table since we'll use Payment Entry instead
			doc.payments = []
			
			frappe.logger().info(
				f"Partial payment: amount_paid={amount_paid}, "
				f"will create Payment Entry after invoice submission"
			)
		else:
			# Normal payment: Calculate paid amounts from payment entries
			total_payment_amount = 0.0
			if doc.payments and len(doc.payments) > 0:
				total_payment_amount = sum(flt(payment.amount) for payment in doc.payments)
			
			# If no payment entries but amount_paid was provided, use that (for backward compatibility)
			if total_payment_amount == 0 and amount_paid > 0:
				total_payment_amount = amount_paid
			
			# Set paid amounts - ERPNext will validate these match payment entries
			doc.paid_amount = flt(total_payment_amount, doc.precision("paid_amount"))
			doc.base_paid_amount = flt(total_payment_amount, doc.precision("base_paid_amount"))
			
			# Validate payment entries sum matches paid_amount (ERPNext requirement)
			if doc.payments and len(doc.payments) > 0:
				payment_sum = sum(flt(payment.amount) for payment in doc.payments)
				if abs(payment_sum - doc.paid_amount) > 0.01:  # Allow small rounding differences
					frappe.logger().warning(
						f"Payment sum mismatch: payments={payment_sum}, paid_amount={doc.paid_amount}. "
						f"Adjusting paid_amount to match payment entries."
					)
					doc.paid_amount = flt(payment_sum, doc.precision("paid_amount"))
					doc.base_paid_amount = flt(payment_sum, doc.precision("base_paid_amount"))
		
		# Outstanding amount will be calculated automatically by ERPNext on save
		# We don't need to set it manually - ERPNext does: outstanding_amount = grand_total - paid_amount

		# Ensure customer and customer_name are set before save/submit
		# This is critical for receivable account validation in credit sales
		if not doc.customer:
			frappe.throw("Customer is required for invoice creation")
		
		if not doc.customer_name:
			try:
				customer_doc = frappe.get_doc("Customer", doc.customer)
				doc.customer_name = customer_doc.customer_name or customer_doc.name
			except Exception as e:
				frappe.log_error(f"Error setting customer_name: {str(e)}")
				frappe.throw(f"Error setting customer name: {str(e)}")
		
		# Save and submit atomically — if submit fails we must NOT leave an
		# orphaned draft in the database.  Using a DB savepoint lets us roll
		# back the save when submit raises (e.g. negative-stock validation).
		#
		# Bypass expired-batch check for entire save+submit cycle since POS
		# cashiers may need to sell items with stale/incorrect expiry dates.
		_patch_expired_batch_bypass(doc)
		try:
			frappe.db.savepoint("before_invoice_save")
			doc.save(ignore_permissions=True)
		except Exception as save_error:
			frappe.db.rollback(save_point="before_invoice_save")
			_unpatch_expired_batch_bypass(doc)
			frappe.log_error(frappe.get_traceback(), f"Error saving invoice: {str(save_error)}")
			frappe.throw(f"Error saving invoice: {str(save_error)}")

		try:
			doc.submit()
		except Exception as submit_error:
			frappe.db.rollback(save_point="before_invoice_save")
			_unpatch_expired_batch_bypass(doc)
			frappe.log_error(frappe.get_traceback(), f"Error submitting invoice: {str(submit_error)}")
			error_msg = str(submit_error)
			if hasattr(submit_error, 'message'):
				error_msg = submit_error.message
			frappe.throw(f"Error submitting invoice: {error_msg}")
		_unpatch_expired_batch_bypass(doc)

		_ensure_gl_entries(doc)

		payment_entry = None
		should_create_payment_entry = False

		# Handle partial payment - create Payment Entries for each payment mode
		if is_partial_payment and amount_paid > 0 and mode_of_payment:
			try:
				payment_modes = []
				if isinstance(mode_of_payment, list):
					for pm in mode_of_payment:
						pm_amount = flt(pm.get("amount", 0))
						if pm_amount > 0:
							payment_modes.append((pm.get("method"), pm_amount))
				elif amount_paid > 0:
					payment_modes.append((mode_of_payment, amount_paid))

				remaining_outstanding = flt(doc.outstanding_amount)
				for pm_method, pm_amount in payment_modes:
					alloc = min(flt(pm_amount), remaining_outstanding)
					if alloc <= 0:
						break
					pe = create_partial_payment_entry(doc, pm_method, alloc)
					frappe.logger().info(
						f"Created partial payment entry {pe.name} for {alloc} ({pm_method}) "
						f"against invoice {doc.name}"
					)
					remaining_outstanding -= alloc
					doc.reload()

				payment_entry = pe if payment_modes else None
			except Exception as e:
				frappe.log_error(frappe.get_traceback(), f"Partial Payment Entry Error for {doc.name}")
				frappe.logger().error(f"Failed to create partial payment entry: {e}")
				doc.reload()
		
		# Handle B2B payment entries (existing logic)
		elif business_type == "B2B":
			should_create_payment_entry = True
		elif business_type == "B2B & B2C":
			# For B2B & B2C, only create payment entry for company customers
			global _cached_customer_data
			if customer not in _cached_customer_data:
				_cached_customer_data[customer] = frappe.get_doc("Customer", customer)

			customer_doc = _cached_customer_data[customer]
			if customer_doc.customer_type == "Company":
				should_create_payment_entry = True

		if should_create_payment_entry and mode_of_payment and amount_paid > 0 and not is_partial_payment:
			try:
				payment_entry = create_payment_entry(doc, mode_of_payment, amount_paid)
			except Exception:
				frappe.log_error(frappe.get_traceback(), f"Payment Entry Error for {doc.name}")
				payment_entry = None

		processing_time = time.time() - start_time
		frappe.logger().info(f"Invoice {doc.name} processed in {processing_time:.2f} seconds")

		# Return minimal invoice data for frontend performance
		return {
			"success": True,
			"invoice_name": doc.name,
			"invoice_id": doc.name,
			"invoice": {
				"name": doc.name,
				"doctype": doc.doctype,
				"customer": doc.customer,
				"customer_name": doc.customer_name,
				"posting_date": doc.posting_date,
				"base_grand_total": doc.base_grand_total,
				"currency": doc.currency,
				"status": doc.status,
				"is_pos": doc.is_pos,
				"company": doc.company,
				"paid_amount": doc.paid_amount,
				"outstanding_amount": doc.outstanding_amount,
				"is_partial_payment": is_partial_payment,
				"is_credit_sale": is_credit_sale,
			},
			"payment_entry": payment_entry.name if payment_entry else None,
			"processing_time": round(processing_time, 2),
		}

	except Exception as e:
		error_traceback = frappe.get_traceback()
		error_message = str(e)
		if hasattr(e, 'message'):
			error_message = e.message
		# Roll back the ENTIRE transaction so no orphaned draft invoices,
		# Serial and Batch Bundles, or other side-effects are committed.
		frappe.db.rollback()
		# Log *after* rollback so the error log itself gets committed in
		# its own implicit transaction.
		frappe.log_error(error_traceback, "Submit Invoice Error")
		frappe.db.commit()
		return {"success": False, "message": error_message, "error": error_message}


@frappe.whitelist()
def create_draft_invoice(data):
	try:
		(
			customer,
			items,
			amount_paid,
			sales_and_tax_charges,
			mode_of_payment,
			business_type,
			roundoff_amount,
			delivery_personnel,
			is_credit_sale,
			is_partial_payment,
			partial_payment_amount,
			outstanding_amount,
		) = parse_invoice_data(data)
		doc = build_sales_invoice_doc(
			customer,
			items,
			amount_paid,
			sales_and_tax_charges,
			mode_of_payment,
			business_type,
			roundoff_amount,
			include_payments=True,
			delivery_personnel=delivery_personnel,
			is_credit_sale=is_credit_sale,
			is_partial_payment=is_partial_payment,
		)
		doc.insert(ignore_permissions=True)

		return {"success": True, "invoice_name": doc.name, "invoice": doc}

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Draft Invoice Error")
		return {"success": False, "message": str(e)}


def parse_invoice_data(data):
	"""Sanitize and extract customer and items from request payload including round-off."""
	if isinstance(data, str):
		data = json.loads(data)

	customer = data.get("customer", {}).get("id")
	items = data.get("items", [])

	amount_paid = 0.0
	sales_and_tax_charges = get_current_pos_profile().taxes_and_charges
	business_type = data.get("businessType")
	mode_of_payment = None

	# Extract round-off data from frontend
	roundoff_amount = data.get("roundOffAmount", 0.0)

	# Only get round-off account if round-off amount is not zero
	if roundoff_amount != 0:
		_roundoff_account = get_writeoff_account()

	if data.get("amountPaid"):
		amount_paid = data.get("amountPaid")

	if data.get("paymentMethods"):
		mode_of_payment = data.get("paymentMethods")

	if data.get("SalesTaxCharges"):
		sales_and_tax_charges = data.get("SalesTaxCharges")

	# Extract delivery personnel
	delivery_personnel = data.get("deliveryPersonnel")

	# Extract isCreditSale flag
	is_credit_sale = data.get("isCreditSale", False)

	# Extract isPartialPayment flag and outstanding amount for partial payments
	is_partial_payment = data.get("isPartialPayment", False)
	partial_payment_amount = flt(data.get("partialPaymentAmount", 0.0))
	outstanding_amount = flt(data.get("outstandingAmount", 0.0))

	if not customer or not items:
		frappe.throw(_("Customer and items are required"))

	return (
		customer,
		items,
		amount_paid,
		sales_and_tax_charges,
		mode_of_payment,
		business_type,
		roundoff_amount,
		delivery_personnel,
		is_credit_sale,
		is_partial_payment,
		partial_payment_amount,
		outstanding_amount,
	)


def build_sales_invoice_doc(
	customer,
	items,
	amount_paid,
	sales_and_tax_charges,
	mode_of_payment,
	business_type,
	roundoff_amount=0.0,
	include_payments=False,
	delivery_personnel=None,
	is_credit_sale=False,
	is_partial_payment=False,
):
	"""Main function to build a sales invoice document."""
	doc = frappe.new_doc("Sales Invoice")
	doc.customer = customer
	
	# Ensure customer_name is set (required for receivable account validation)
	try:
		customer_doc = frappe.get_doc("Customer", customer)
		doc.customer_name = customer_doc.customer_name or customer_doc.name
	except Exception:
		# Fallback - will be set automatically by ERPNext
		pass
	
	doc.due_date = frappe.utils.nowdate()
	doc.custom_delivery_date = frappe.utils.nowdate()

	# Set delivery personnel if provided
	if delivery_personnel:
		doc.custom_delivery_personnel = delivery_personnel

	# Configure POS profile and company settings
	pos_profile = _get_active_pos_profile()
	# For partial payments, treat like credit sale (is_pos=0) to allow outstanding amounts
	is_non_pos_invoice = is_credit_sale or is_partial_payment
	_set_pos_profile_fields(doc, pos_profile, customer, business_type, is_non_pos_invoice)

	# Set posting details
	_set_posting_fields(doc)

	# Set POS opening entry
	_set_pos_opening_entry(doc)

	# Handle round-off
	_set_roundoff_fields(doc, roundoff_amount)

	# Set taxes and charges
	_set_taxes_and_charges(doc, sales_and_tax_charges, pos_profile)

	# Add items to invoice
	_populate_invoice_items(doc, items, pos_profile)

	# Populate tax details
	_populate_tax_details(doc)

	# Add payment information
	if include_payments:
		_add_payment_entries(doc, mode_of_payment)

	return doc


def _ensure_gl_entries(doc):
	"""
	Verify that GL/PLE entries exist after invoice submit.
	If missing (e.g. due to a hook error or race condition), recreate them.
	"""
	if doc.docstatus != 1:
		return
	try:
		ple_exists = frappe.db.exists(
			"Payment Ledger Entry",
			{"against_voucher_no": doc.name, "delinked": 0},
		)
		if not ple_exists:
			doc.make_gl_entries()
			frappe.db.commit()
	except Exception:
		frappe.log_error(frappe.get_traceback(), f"_ensure_gl_entries failed for {doc.name}")


def _get_active_pos_profile():
	"""Get the active POS profile from current session or fallback to default."""
	selected_pos_profile_name = None

	try:
		current_opening_entry = get_current_pos_opening_entry()
		if current_opening_entry:
			opening_doc = frappe.get_doc("POS Opening Entry", current_opening_entry)
			selected_pos_profile_name = opening_doc.pos_profile
	except Exception:
		frappe.logger().error(f"Error getting POS Opening Entry: {frappe.get_traceback()}")
		pass

	try:
		if selected_pos_profile_name:
			pos_profile_doc = frappe.get_doc("POS Profile", selected_pos_profile_name)
			return pos_profile_doc
		else:
			fallback_profile = get_current_pos_profile()
			return fallback_profile
	except Exception:
		frappe.logger().error(f"Error getting POS Profile: {frappe.get_traceback()}")
		frappe.logger().error(f"Attempted to get profile: {selected_pos_profile_name}")
		raise


def _set_pos_profile_fields(doc, pos_profile, customer, business_type, is_credit_sale=False):
	"""Set POS profile, company, currency and POS-specific fields."""
	doc.pos_profile = pos_profile.name
	doc.company = pos_profile.company
	doc.currency = get_customer_billing_currency(customer)
	doc.conversion_rate = 1.0
	doc.update_stock = 1
	doc.warehouse = pos_profile.warehouse

	# For credit sales, set is_pos = 0 to bypass payment entry requirement
	# ERPNext POS invoices require at least one payment mode
	if is_credit_sale:
		doc.is_pos = 0
	else:
		# Determine if this is a POS invoice based on business type
		doc.is_pos = _determine_is_pos(customer, business_type)


def _determine_is_pos(customer, business_type):
	"""Determine if the invoice should be marked as POS based on business type."""
	if business_type == "B2C":
		return 1
	elif business_type == "B2B":
		return 0
	elif business_type == "B2B & B2C":
		return _check_customer_type_for_pos(customer)
	else:
		return 0


def _check_customer_type_for_pos(customer):
	"""Check if customer is an individual for B2B & B2C business type."""
	global _cached_customer_data
	if customer not in _cached_customer_data:
		_cached_customer_data[customer] = frappe.get_doc("Customer", customer)

	customer_doc = _cached_customer_data[customer]
	return 1 if customer_doc.customer_type == "Individual" else 0


def _set_posting_fields(doc):
	"""Set posting date, time and related fields."""
	doc.posting_date = frappe.utils.nowdate()
	doc.posting_time = frappe.utils.nowtime()
	doc.set_posting_time = 1


def _set_pos_opening_entry(doc):
	"""Set the current POS opening entry on the document."""
	current_opening_entry = get_current_pos_opening_entry()
	if current_opening_entry:
		doc.custom_pos_opening_entry = current_opening_entry


def _set_roundoff_fields(doc, roundoff_amount):
	"""Set round-off amount and account if roundoff is non-zero."""
	if roundoff_amount != 0:
		conversion_rate = doc.conversion_rate or 1
		doc.custom_roundoff_amount = flt(abs(roundoff_amount))
		doc.custom_roundoff_account = get_writeoff_account()
		doc.custom_base_roundoff_amount = flt(abs(roundoff_amount) * conversion_rate)


def _set_taxes_and_charges(doc, sales_and_tax_charges, pos_profile):
	"""Set the taxes and charges template."""
	if sales_and_tax_charges:
		doc.taxes_and_charges = sales_and_tax_charges
	else:
		doc.taxes_and_charges = pos_profile.taxes_and_charges


def _populate_invoice_items(doc, items, pos_profile):
	"""Add all items to the invoice."""
	item_codes = [item.get("id") for item in items]

	# Batch fetch item data and pre-cache accounts
	item_data_map = _batch_fetch_item_data(item_codes)
	_precache_item_accounts(item_codes, pos_profile.company)

	# Add each item to the invoice
	for item in items:
		item_data = _prepare_item_data(item, item_data_map, pos_profile, doc)
		doc.append("items", item_data)


def _batch_fetch_item_data(item_codes):
	"""Batch fetch item data for all items."""
	if not item_codes:
		return {}

	placeholders = ",".join(["%s"] * len(item_codes))
	item_query = f"""
		SELECT name, has_batch_no, has_serial_no
		FROM `tabItem`
		WHERE name IN ({placeholders})
	"""
	item_results = frappe.db.sql(item_query, tuple(item_codes), as_dict=True)
	return {item.name: item for item in item_results}


def _precache_item_accounts(item_codes, company):
	"""Pre-cache income and expense accounts for all items."""
	if not item_codes:
		return

	# Cache company data
	if company not in _cached_company_data:
		_cached_company_data[company] = frappe.get_doc("Company", company)

	company_doc = _cached_company_data[company]
	income_account = company_doc.default_income_account
	expense_account = company_doc.default_expense_account

	# Pre-populate account cache
	for item_code in item_codes:
		_cached_item_accounts[item_code] = income_account
		_cached_item_accounts[f"{item_code}_expense"] = expense_account


def _prepare_item_data(item, item_data_map, pos_profile, doc):
	"""Prepare item data dictionary for invoice line."""
	item_code = item.get("id")

	# Get accounts and validate
	income_account = get_income_accounts(item_code)
	expense_account = get_expense_accounts(item_code)
	_validate_item_accounts(item_code, income_account, expense_account)

	# Build base item data
	item_data = {
		"item_code": item_code,
		"qty": item.get("quantity"),
		"rate": item.get("price"),
		"income_account": income_account,
		"expense_account": expense_account,
		"warehouse": pos_profile.warehouse,
		"cost_center": pos_profile.cost_center,
	}

	# Add optional fields
	_add_uom_to_item(item_data, item)
	_add_batch_to_item(item_data, item, item_data_map.get(item_code, {}), doc, pos_profile)
	_add_serial_to_item(item_data, item, item_data_map.get(item_code, {}), doc, pos_profile)

	return item_data


def _validate_stock_availability(items):
	"""Check real-time stock — item-level AND batch-level — before invoice creation.

	For batch-tracked items, total warehouse stock might look sufficient (e.g. 17)
	while no single batch actually holds enough (e.g. split across depleted batches).
	We validate both levels so the user gets a clear error before any document is
	saved or submitted.
	"""
	from erpnext.stock.utils import get_stock_balance

	pos_profile = _get_active_pos_profile()
	warehouse = pos_profile.warehouse
	allow_negative = frappe.db.get_single_value("Stock Settings", "allow_negative_stock")
	if allow_negative:
		return

	insufficient = []
	for item in items:
		item_code = item.get("id")
		qty_requested = flt(item.get("quantity"))
		if qty_requested <= 0:
			continue

		item_fields = frappe.db.get_value(
			"Item", item_code, ["is_stock_item", "has_batch_no", "item_name"], as_dict=True
		)
		if not item_fields or not item_fields.is_stock_item:
			continue

		item_name = item_fields.item_name or item_code

		available = get_stock_balance(item_code, warehouse) or 0
		if available < qty_requested:
			insufficient.append(
				f"{item_name}: requested {qty_requested}, available {available} in {warehouse}"
			)
			continue

		if item_fields.has_batch_no:
			batch_value = item.get("batchNumber")
			if batch_value:
				batch_no = _resolve_batch_no(batch_value, item_code)
				if batch_no:
					batch_avail = _get_batch_qty(batch_no, warehouse)
					if batch_avail < qty_requested:
						insufficient.append(
							f"{item_name} (batch {batch_no}): requested {qty_requested}, "
							f"batch has {batch_avail} in {warehouse}"
						)
			else:
				best = _pick_batch_for_item(item_code, warehouse=warehouse, qty_needed=qty_requested)
				if not best:
					insufficient.append(
						f"{item_name}: no single batch has {qty_requested} units in {warehouse} "
						f"(total stock: {available})"
					)

	if insufficient:
		details = "<br>".join(insufficient)
		frappe.throw(
			_("Insufficient stock for the following items:<br>{0}<br><br>"
			  "Please reduce the quantity or restock before selling.").format(details),
			title=_("Insufficient Stock"),
		)


def _validate_item_accounts(item_code, income_account, expense_account):
	"""Validate that required accounts exist for the item."""
	if not income_account:
		frappe.throw(
			f"Income account not found for item {item_code}. "
			"Please check item defaults or company settings."
		)
	if not expense_account:
		frappe.throw(
			f"Expense account not found for item {item_code}. "
			"Please check item defaults or company settings."
		)


def _add_uom_to_item(item_data, item):
	"""Add UOM to item data if specified and not default."""
	selected_uom = item.get("uom")
	if selected_uom and selected_uom != "Nos":
		item_data["uom"] = selected_uom


def _add_batch_to_item(item_data, item, item_db_data, doc, pos_profile):
	"""Ensure batch-tracked items get a Serial and Batch Bundle before submit.

	ERPNext's auto-create (via SerialBatchBundle on SLE submit) only works when
	batches have positive available stock.  When the only batch has zero or
	negative stock the auto-create silently returns nothing and the SLE
	validation throws "Serial No / Batch No are mandatory".

	We therefore always create the bundle ourselves so the SLE already has it.
	"""
	if not item_db_data.get("has_batch_no", 0):
		return

	item_code = item_data["item_code"]
	batch_value = item.get("batchNumber")

	if batch_value:
		batch_no = _resolve_batch_no(batch_value, item_code)
		if not batch_no:
			frappe.throw(
				_("Invalid or unknown Batch for item {0}: {1}").format(item_code, batch_value)
			)
	else:
		qty_needed = flt(item_data.get("qty"), 9)
		batch_no = _pick_batch_for_item(item_code, warehouse=pos_profile.warehouse, qty_needed=qty_needed)

	if not batch_no:
		allow_negative = frappe.db.get_single_value("Stock Settings", "allow_negative_stock")
		if not allow_negative:
			item_name = frappe.db.get_value("Item", item_code, "item_name") or item_code
			frappe.throw(
				_("No batch with sufficient stock found for {0} in warehouse {1}. "
				  "Please restock or adjust the quantity.").format(item_name, pos_profile.warehouse),
				title=_("Insufficient Batch Stock"),
			)
		return

	qty = flt(item_data.get("qty"), 9)
	bundle_name = _create_outward_bundle(
		item_code=item_code,
		warehouse=pos_profile.warehouse,
		batch_no=batch_no,
		qty=qty,
		doc=doc,
	)
	item_data["use_serial_batch_fields"] = 1
	item_data["batch_no"] = batch_no
	if bundle_name:
		item_data["serial_and_batch_bundle"] = bundle_name


def _add_serial_to_item(item_data, item, item_db_data, doc, pos_profile):
	"""Ensure serial-tracked items get a Serial and Batch Bundle before submit."""
	if not item_db_data.get("has_serial_no", 0):
		return
	serial_number = item.get("serialNumber")
	if not serial_number:
		return
	if item_data.get("serial_and_batch_bundle"):
		return

	from erpnext.stock.doctype.serial_no.serial_no import get_serial_nos
	serial_nos = get_serial_nos(serial_number)
	if not serial_nos:
		return

	qty = flt(item_data.get("qty"), 9)
	bundle_name = _create_outward_bundle(
		item_code=item_data["item_code"],
		warehouse=pos_profile.warehouse,
		qty=qty,
		doc=doc,
		serial_nos=serial_nos,
	)
	item_data["use_serial_batch_fields"] = 1
	item_data["serial_no"] = serial_number
	if bundle_name:
		item_data["serial_and_batch_bundle"] = bundle_name


# ---------------------------------------------------------------------------
#  Helpers
# ---------------------------------------------------------------------------

def _resolve_batch_no(batch_value, item_code):
	"""Resolve frontend batch value (batch_id or Batch name) to Batch doctype name."""
	if not batch_value or not item_code:
		return None
	if frappe.db.exists("Batch", batch_value):
		return batch_value
	return frappe.db.get_value(
		"Batch",
		{"batch_id": batch_value, "item": item_code},
		"name",
	)


def _get_batch_qty(batch_no, warehouse):
	"""Get batch qty accounting for both old-style (SLE.batch_no) and
	new-style (Serial and Batch Bundle) stock tracking."""
	# Old-style: batch_no stored directly on the Stock Ledger Entry
	old_qty = frappe.db.sql(
		"""SELECT COALESCE(SUM(actual_qty), 0)
		   FROM `tabStock Ledger Entry`
		   WHERE batch_no = %s AND warehouse = %s AND is_cancelled = 0""",
		(batch_no, warehouse),
	)[0][0] or 0

	# New-style: batch tracked via Serial and Batch Bundle entries
	new_qty = frappe.db.sql(
		"""SELECT COALESCE(SUM(sbe.qty), 0)
		   FROM `tabSerial and Batch Entry` sbe
		   JOIN `tabSerial and Batch Bundle` sbb ON sbb.name = sbe.parent
		   WHERE sbe.batch_no = %s
		     AND sbe.warehouse = %s
		     AND sbb.docstatus = 1
		     AND sbb.is_cancelled = 0""",
		(batch_no, warehouse),
	)[0][0] or 0

	return flt(old_qty + new_qty)


def _pick_batch_for_item(item_code, warehouse=None, qty_needed=0):
	"""Return the best batch for *item_code* that has sufficient stock.

	Prioritises non-expired batches (FEFO).  Falls back to expired batches
	only when no non-expired batch can satisfy the request.

	Handles both old-style (SLE.batch_no) and new-style (Serial and Batch
	Bundle) stock tracking.
	"""
	if not warehouse:
		pos_profile = _get_active_pos_profile()
		warehouse = pos_profile.warehouse

	today = frappe.utils.nowdate()

	batches = frappe.db.sql(
		"""SELECT name, expiry_date FROM `tabBatch`
		   WHERE item = %s AND disabled = 0
		   ORDER BY expiry_date ASC, creation ASC""",
		item_code,
		as_dict=True,
	)

	best_valid = None
	best_valid_qty = 0
	best_expired = None
	best_expired_qty = 0

	for b in batches:
		available = _get_batch_qty(b.name, warehouse)
		if available <= 0:
			continue

		is_expired = b.expiry_date and getdate(b.expiry_date) < getdate(today)

		if not is_expired:
			if available >= qty_needed and qty_needed > 0:
				return b.name
			if available > best_valid_qty:
				best_valid_qty = available
				best_valid = b.name
		else:
			if available >= qty_needed and qty_needed > 0 and not best_expired:
				best_expired = b.name
				best_expired_qty = available
			elif available > best_expired_qty:
				best_expired_qty = available
				best_expired = b.name

	return best_valid or best_expired


def _create_outward_bundle(item_code, warehouse, qty, doc, batch_no=None, serial_nos=None):
	"""Create a draft Serial and Batch Bundle for an outward (sales) transaction.

	By explicitly passing ``batches`` / ``serial_nos`` we bypass
	``get_available_batches`` which only returns batches with positive stock.
	"""
	from erpnext.stock.serial_batch_bundle import SerialBatchCreation

	kwargs = {
		"item_code": item_code,
		"warehouse": warehouse,
		"qty": qty,
		"type_of_transaction": "Outward",
		"voucher_type": "Sales Invoice",
		"voucher_no": doc.name or "",
		"posting_date": doc.posting_date or frappe.utils.nowdate(),
		"posting_time": getattr(doc, "posting_time", None) or frappe.utils.nowtime(),
		"company": doc.company,
		"do_not_submit": True,
	}
	if batch_no:
		kwargs["batches"] = frappe._dict({batch_no: qty})
	if serial_nos:
		kwargs["serial_nos"] = serial_nos

	try:
		bundle_doc = SerialBatchCreation(kwargs).make_serial_and_batch_bundle()
	except Exception:
		frappe.log_error(frappe.get_traceback(), "Serial Batch Bundle Creation Error")
		return None

	if bundle_doc and bundle_doc.get("name"):
		return bundle_doc.name
	return None


def _populate_tax_details(doc):
	"""Populate tax details from the taxes and charges template."""
	if not doc.taxes_and_charges:
		return

	tax_doc = get_tax_template(doc.taxes_and_charges)
	if not tax_doc:
		return

	for tax in tax_doc.taxes:
		doc.append(
			"taxes",
			{
				"charge_type": tax.charge_type,
				"account_head": tax.account_head,
				"description": tax.description,
				"cost_center": tax.cost_center,
				"rate": tax.rate,
				"row_id": tax.row_id,
				"tax_amount": tax.tax_amount,
				"included_in_print_rate": tax.included_in_print_rate,
			},
		)


def _add_payment_entries(doc, mode_of_payment):
	"""Add payment entries to the invoice."""
	if not isinstance(mode_of_payment, list):
		return

	for payment in mode_of_payment:
		payment_method = payment.get("method", "")
		payment_amount = flt(payment.get("amount", 0))
		
		# Add payment entry if amount is greater than 0 (normal payment)
		# OR if amount is 0 and it's Credit payment method (for credit sales)
		payment_method_lower = payment_method.lower() if payment_method else ""
		is_credit_method = payment_method_lower in ["credit", "credit sale"]
		
		if payment_amount > 0:
			# Normal payment - add it
			doc.append(
				"payments",
				{"mode_of_payment": payment_method, "amount": payment_amount},
			)
		elif payment_amount == 0 and is_credit_method:
			# Credit sale - add payment entry with 0 amount
			doc.append(
				"payments",
				{"mode_of_payment": payment_method, "amount": 0.0},
			)
		# If amount is 0 and not Credit, don't add it (skip)


def get_tax_template(template_name):
	"""
	Optimized tax template getter with caching.
	Custom helper function to fetch Sales Taxes and Charges Template.
	Returns the full template document or raises an error if not found.
	"""
	global _cached_item_accounts

	if not template_name:
		return None

	cache_key = f"tax_template_{template_name}"
	if cache_key not in _cached_item_accounts:
		try:
			template_doc = frappe.get_doc("Sales Taxes and Charges Template", template_name)
			_cached_item_accounts[cache_key] = template_doc
		except frappe.DoesNotExistError:
			frappe.throw(f"Tax Template '{template_name}' not found")
		except Exception as e:
			frappe.log_error(f"Error fetching tax template {template_name}: {e!s}")
			_cached_item_accounts[cache_key] = None

	return _cached_item_accounts[cache_key]


def get_customer_billing_currency(customer):
	try:
		customer_doc = frappe.get_doc("Customer", customer)
		if customer_doc.default_currency:
			return customer_doc.default_currency
	except Exception:
		pass

	# Fallback to company currency
	pos_profile = get_current_pos_profile()
	company_doc = frappe.get_doc("Company", pos_profile.company)
	return company_doc.default_currency


def get_income_accounts(item_code):
	"""Optimized income account getter with caching"""
	global _cached_item_accounts

	if item_code not in _cached_item_accounts:
		try:
			pos_profile = get_current_pos_profile()
			company = pos_profile.company

			# Cache company data
			if company not in _cached_company_data:
				_cached_company_data[company] = frappe.get_doc("Company", company)

			company_doc = _cached_company_data[company]
			_cached_item_accounts[item_code] = company_doc.default_income_account
		except Exception as e:
			frappe.log_error(
				f"Error fetching income account for {item_code}: {e!s}",
				"Income Account Error",
			)
			_cached_item_accounts[item_code] = None

	return _cached_item_accounts[item_code]


def get_expense_accounts(item_code):
	"""Optimized expense account getter with caching"""
	global _cached_item_accounts

	cache_key = f"{item_code}_expense"
	if cache_key not in _cached_item_accounts:
		try:
			pos_profile = get_current_pos_profile()
			company = pos_profile.company

			# Cache company data
			if company not in _cached_company_data:
				_cached_company_data[company] = frappe.get_doc("Company", company)

			company_doc = _cached_company_data[company]
			_cached_item_accounts[cache_key] = company_doc.default_expense_account
		except Exception as e:
			frappe.log_error(
				f"Error fetching expense account for {item_code}: {e!s}",
				"Expense Account Error",
			)
			_cached_item_accounts[cache_key] = None

	return _cached_item_accounts[cache_key]


from frappe.model.mapper import get_mapped_doc


@frappe.whitelist()
def return_sales_invoice(invoice_name):
	try:
		original_invoice = frappe.get_doc("Sales Invoice", invoice_name)

		if original_invoice.docstatus != 1:
			frappe.throw("Only submitted invoices can be returned.")

		if original_invoice.is_return:
			frappe.throw("This invoice is already a return.")

		# Exclude payment mapping
		return_doc = get_mapped_doc(
			"Sales Invoice",
			invoice_name,
			{
				"Sales Invoice": {
					"doctype": "Sales Invoice",
					"field_map": {"name": "return_against"},
					"validation": {"docstatus": ["=", 1]},
				},
				"Sales Invoice Item": {
					"doctype": "Sales Invoice Item",
					"field_map": {"name": "prevdoc_detail_docname"},
				},
			},
		)

		return_doc.is_return = 1
		return_doc.posting_date = frappe.utils.nowdate()

		for item in return_doc.items:
			item.qty = -abs(item.qty)

		# Mirror original round-off/write-off as POSITIVE on return; totals logic handles sign for returns
		try:
			if getattr(original_invoice, "custom_roundoff_amount", 0):
				return_doc.custom_roundoff_amount = abs(original_invoice.custom_roundoff_amount or 0)
				return_doc.custom_base_roundoff_amount = abs(
					getattr(original_invoice, "custom_base_roundoff_amount", 0) or 0
				)
				# keep same account
				return_doc.custom_roundoff_account = getattr(
					original_invoice, "custom_roundoff_account", None
				)
				# Do not set standard write_off fields on returns to avoid double impact in GL
		except Exception:
			# non-fatal; continue without custom roundoff
			pass

		return_doc.payments = []
		for p in original_invoice.payments:
			return_doc.append(
				"payments",
				{
					"mode_of_payment": p.mode_of_payment,
					"amount": -abs(p.amount),
					"account": p.account,
				},
			)

		# Payment sync will be handled after save so totals include write-off adjustments

		return_doc.save(ignore_permissions=True)

		# After save (totals finalized by validate), sync payments to match grand/rounded total
		if getattr(return_doc, "custom_roundoff_amount", 0):
			try:
				return_doc.reload()
			except Exception:
				pass
			final_total = getattr(return_doc, "rounded_total", None)
			if final_total is None:
				final_total = return_doc.grand_total
			desired_payment = abs(flt(final_total, return_doc.precision("grand_total")))
			if desired_payment > 0:
				if return_doc.payments and len(return_doc.payments) > 0:
					# For returns, record refund as positive amount on payment row
					return_doc.payments[0].amount = desired_payment
					for _p in return_doc.payments[1:]:
						_p.amount = 0
				else:
					return_doc.append(
						"payments",
						{"mode_of_payment": "Cash", "amount": desired_payment},
					)
			# Sync totals fields
			return_doc.paid_amount = desired_payment
			return_doc.base_paid_amount = desired_payment * (return_doc.conversion_rate or 1)
			return_doc.outstanding_amount = 0
			return_doc.save(ignore_permissions=True)

		return_doc.submit()

		return {"success": True, "return_invoice": return_doc.name}

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Return Invoice Error")
		return {"success": False, "message": str(e)}


# Add this function to handle round-off amount calculation and write-off
def set_base_roundoff_amount(doc, method):
	"""Set base round-off amount based on conversion rate"""
	if not doc.custom_roundoff_amount:
		return
	if not doc.conversion_rate:
		frappe.throw(_("Please set Exchange Rate First"))
	doc.custom_base_roundoff_amount = doc.conversion_rate * doc.custom_roundoff_amount


def set_grand_total_with_roundoff(doc, method):
	"""Modify grand total calculation to include round-off amount"""
	from erpnext.controllers.taxes_and_totals import calculate_taxes_and_totals

	if not doc.doctype == "Sales Invoice":
		return
	if not doc.custom_roundoff_account or not doc.custom_roundoff_amount:
		return

	# Monkey Patch calculate_totals method to include round-off
	calculate_taxes_and_totals.calculate_totals = custom_calculate_totals


def custom_calculate_totals(self):
	"""Main function to calculate invoice totals with custom round-off logic"""
	# Calculate basic grand total and taxes
	if self.doc.get("taxes"):
		self.doc.grand_total = flt(self.doc.get("taxes")[-1].total) + flt(self.doc.get("grand_total_diff"))
	else:
		self.doc.grand_total = flt(self.doc.net_total)

	if self.doc.get("taxes"):
		self.doc.total_taxes_and_charges = flt(
			self.doc.grand_total - self.doc.net_total - flt(self.doc.get("grand_total_diff")),
			self.doc.precision("total_taxes_and_charges"),
		)
	else:
		self.doc.total_taxes_and_charges = 0.0
	# Apply existing roundoff amount
	if (
		self.doc.doctype == "Sales Invoice"
		and self.doc.custom_roundoff_account
		and self.doc.custom_roundoff_amount
	):
		adjustment = self.doc.custom_roundoff_amount or 0

		# For returns, add the round-off to reduce the negative magnitude (e.g., -13 + 3.01 = -9.99)
		if getattr(self.doc, "is_return", 0):
			self.doc.grand_total += adjustment
		else:
			# Normal invoices subtract the round-off (e.g., 13 - 3.01 = 9.99)
			self.doc.grand_total -= adjustment

	self._set_in_company_currency(self.doc, ["total_taxes_and_charges", "rounding_adjustment"])
	# Calculate base currency totals
	if self.doc.doctype in [
		"Quotation",
		"Sales Order",
		"Delivery Note",
		"Sales Invoice",
		"POS Invoice",
	]:
		self.doc.base_grand_total = (
			flt(
				self.doc.grand_total * self.doc.conversion_rate,
				self.doc.precision("base_grand_total"),
			)
			if self.doc.total_taxes_and_charges
			else self.doc.base_net_total
		)
	else:
		self.doc.taxes_and_charges_added = self.doc.taxes_and_charges_deducted = 0.0
		for tax in self.doc.get("taxes"):
			if tax.category in ["Valuation and Total", "Total"]:
				if tax.add_deduct_tax == "Add":
					self.doc.taxes_and_charges_added += flt(tax.tax_amount_after_discount_amount)
				else:
					self.doc.taxes_and_charges_deducted += flt(tax.tax_amount_after_discount_amount)

		self.doc.round_floats_in(self.doc, ["taxes_and_charges_added", "taxes_and_charges_deducted"])

		self.doc.base_grand_total = (
			flt(self.doc.grand_total * self.doc.conversion_rate)
			if (self.doc.taxes_and_charges_added or self.doc.taxes_and_charges_deducted)
			else self.doc.base_net_total
		)

		self._set_in_company_currency(self.doc, ["taxes_and_charges_added", "taxes_and_charges_deducted"])

	self.doc.round_floats_in(self.doc, ["grand_total", "base_grand_total"])
	# Mania: Auto write-off small decimal amounts (e.g., 10.01 -> 10.00, -50.01 -> -50.00)
	if self.doc.doctype == "Sales Invoice":
		if self.doc.grand_total > 0:
			grand_total_int = int(self.doc.grand_total)
			# Float-safe fractional part (handles cases like 100.0100000001)
			decimal_part = flt(self.doc.grand_total - grand_total_int, 6)
			# If decimal part is very small (<= 0.01), write it off (with small tolerance)
			if decimal_part > 0 and decimal_part <= (0.01 + 1e-6):
				writeoff_account = get_writeoff_account()
				if writeoff_account:
					small_amount = decimal_part
					if self.doc.custom_roundoff_amount:
						self.doc.custom_roundoff_amount += small_amount
					else:
						self.doc.custom_roundoff_amount = small_amount
					self.doc.custom_roundoff_account = writeoff_account
					self.doc.custom_base_roundoff_amount = self.doc.custom_roundoff_amount * (
						self.doc.conversion_rate or 1
					)
					# For positive totals, subtract to reach .00
					self.doc.grand_total -= small_amount
					self.doc.base_grand_total = self.doc.grand_total * (self.doc.conversion_rate or 1)
		elif self.doc.grand_total < 0:
			abs_total = abs(self.doc.grand_total)
			abs_int = int(abs_total)
			decimal_part = flt(abs_total - abs_int, 6)
			if decimal_part > 0 and decimal_part <= (0.01 + 1e-6):
				writeoff_account = get_writeoff_account()
				if writeoff_account:
					small_amount = decimal_part
					if self.doc.custom_roundoff_amount:
						self.doc.custom_roundoff_amount += small_amount
					else:
						self.doc.custom_roundoff_amount = small_amount
					self.doc.custom_roundoff_account = writeoff_account
					self.doc.custom_base_roundoff_amount = self.doc.custom_roundoff_amount * (
						self.doc.conversion_rate or 1
					)
					# For negative totals, add to reach .00 (e.g., -50.01 + 0.01 = -50)
					self.doc.grand_total += small_amount
					self.doc.base_grand_total = self.doc.grand_total * (self.doc.conversion_rate or 1)
	# print("Round-off amount before adjustment:", self.doc.custom_roundoff_amount)

	self.set_rounded_total()


def create_roundoff_writeoff_entry(self):
	"""Create a write-off entry for round-off amount"""
	if not self.doc.custom_roundoff_amount or not self.doc.custom_roundoff_account:
		return
	if self.doc.is_return:
		write_off_amount = -self.doc.custom_roundoff_amount
	else:
		write_off_amount = self.doc.custom_roundoff_amount

	roundoff_entry = {
		"charge_type": "Actual",
		"account_head": self.doc.custom_roundoff_account,
		"description": "Round Off Adjustment",
		"tax_amount": write_off_amount,
		"base_tax_amount": write_off_amount or (write_off_amount * self.doc.conversion_rate),
		"add_deduct_tax": "Add" if write_off_amount > 0 else "Deduct",
		"category": "Total",
		"included_in_print_rate": 0,
		"cost_center": self.doc.cost_center
		or frappe.get_cached_value("Company", self.doc.company, "cost_center"),
	}

	self.doc.append("taxes", roundoff_entry)


def get_writeoff_account():
	pos_profile = get_current_pos_profile()
	if pos_profile.write_off_account:
		return pos_profile.write_off_account


class CustomSalesInvoice(SalesInvoice):
	def get_gl_entries(self, warehouse_account=None):
		from erpnext.accounts.general_ledger import merge_similar_entries

		gl_entries = []

		self.make_roundoff_gl_entry(gl_entries)

		self.make_customer_gl_entry(gl_entries)

		self.make_tax_gl_entries(gl_entries)
		self.make_internal_transfer_gl_entries(gl_entries)

		self.make_item_gl_entries(gl_entries)
		self.make_precision_loss_gl_entry(gl_entries)
		self.make_discount_gl_entries(gl_entries)

		gl_entries = make_regional_gl_entries(gl_entries, self)

		# merge gl entries before adding pos entries
		gl_entries = merge_similar_entries(gl_entries)

		self.make_loyalty_point_redemption_gle(gl_entries)
		self.make_pos_gl_entries(gl_entries)

		self.make_write_off_gl_entry(gl_entries)
		self.make_gle_for_rounding_adjustment(gl_entries)

		return gl_entries

	def make_roundoff_gl_entry(self, gl_entries):
		if self.custom_roundoff_account and self.custom_roundoff_amount:
			against_voucher = self.name
			# For return invoices, reverse the GL impact (credit instead of debit)
			if getattr(self, "is_return", 0):
				gl_entries.append(
					self.get_gl_dict(
						{
							"account": self.custom_roundoff_account,
							"party_type": "Customer",
							"party": self.customer,
							"due_date": self.due_date,
							"against": against_voucher,
							"credit": self.custom_base_roundoff_amount,
							"credit_in_account_currency": (
								self.custom_base_roundoff_amount
								if self.party_account_currency == self.company_currency
								else self.custom_roundoff_amount
							),
							"against_voucher": against_voucher,
							"against_voucher_type": self.doctype,
							"cost_center": (
								self.cost_center
								if self.cost_center
								else "Main - " + frappe.db.get_value("Company", self.company, "abbr")
							),
							"project": self.project,
						},
						self.party_account_currency,
						item=self,
					)
				)
			else:
				gl_entries.append(
					self.get_gl_dict(
						{
							"account": self.custom_roundoff_account,
							"party_type": "Customer",
							"party": self.customer,
							"due_date": self.due_date,
							"against": against_voucher,
							"debit": self.custom_base_roundoff_amount,
							"debit_in_account_currency": (
								self.custom_base_roundoff_amount
								if self.party_account_currency == self.company_currency
								else self.custom_roundoff_amount
							),
							"against_voucher": against_voucher,
							"against_voucher_type": self.doctype,
							"cost_center": (
								self.cost_center
								if self.cost_center
								else "Main - " + frappe.db.get_value("Company", self.company, "abbr")
							),
							"project": self.project,
						},
						self.party_account_currency,
						item=self,
					)
				)


@erpnext.allow_regional
def make_regional_gl_entries(gl_entries, doc):
	return gl_entries


def create_payment_entry(sales_invoice, mode_of_payment, amount_paid):
	"""
	Create Payment Entry for B2B Sales Invoice.
	Uses Administrator context to bypass permission issues for non-admin POS users.
	"""
	from frappe.utils import getdate, nowdate

	original_user = frappe.session.user
	opening_entry = get_current_pos_opening_entry() or ""

	frappe.set_user("Administrator")
	try:
		company = sales_invoice.company
		customer = sales_invoice.customer
		company_doc = frappe.get_doc("Company", company)

		if isinstance(mode_of_payment, list) and len(mode_of_payment) > 0:
			first_payment = mode_of_payment[0]
			mop_name = first_payment["method"]
		else:
			mop_name = "Cash"

		mode_of_payment_doc = frappe.get_doc("Mode of Payment", mop_name)
		paid_to_account = None
		for account in mode_of_payment_doc.accounts:
			if account.company == company:
				paid_to_account = account.default_account
				break
		if not paid_to_account:
			paid_to_account = company_doc.default_cash_account

		pe_data = {
			"doctype": "Payment Entry",
			"payment_type": "Receive",
			"party_type": "Customer",
			"party": customer,
			"company": company,
			"posting_date": nowdate(),
			"paid_amount": amount_paid,
			"received_amount": amount_paid,
			"source_exchange_rate": 1,
			"target_exchange_rate": 1,
			"party_account": get_customer_receivable_account(customer, company),
			"paid_to": paid_to_account,
			"mode_of_payment": mop_name,
			"paid_from_account_currency": sales_invoice.currency,
			"paid_to_account_currency": sales_invoice.currency,
			"references": [{
				"reference_doctype": "Sales Invoice",
				"reference_name": sales_invoice.name,
				"allocated_amount": amount_paid,
			}],
		}

		paid_to_type = frappe.get_cached_value("Account", paid_to_account, "account_type")
		if paid_to_type == "Bank":
			pe_data["reference_no"] = f"POS-B2B-{nowdate()}-{sales_invoice.name}"
			pe_data["reference_date"] = getdate(nowdate())

		pe_meta = frappe.get_meta("Payment Entry")
		if pe_meta.has_field("custom_pos_opening_entry") and opening_entry:
			pe_data["custom_pos_opening_entry"] = opening_entry
		if pe_meta.has_field("custom_pos_payment_type"):
			pe_data["custom_pos_payment_type"] = "Partial Payment"

		pe = frappe.get_doc(pe_data)
		pe.set_missing_values()
		pe.set_missing_ref_details(force=True)
		pe.insert(ignore_permissions=True)
		pe.submit()

		frappe.db.set_value("Payment Entry", pe.name, {
			"owner": original_user,
			"modified_by": original_user,
		}, update_modified=False)

		return pe

	except Exception as e:
		frappe.log_error(
			frappe.get_traceback(),
			f"Error creating payment entry for invoice {sales_invoice.name}",
		)
		frappe.throw(f"Failed to create payment entry: {e!s}")
	finally:
		frappe.set_user(original_user)


def create_partial_payment_entry(sales_invoice, mode_of_payment, payment_amount):
	"""
	Create Payment Entry for partial payment on a Sales Invoice.
	Uses Administrator context to bypass permission issues for non-admin POS users,
	then re-attributes ownership to the actual cashier.
	"""
	from frappe.utils import getdate, nowdate

	original_user = frappe.session.user
	opening_entry = get_current_pos_opening_entry() or ""

	frappe.set_user("Administrator")
	try:
		company = sales_invoice.company
		customer = sales_invoice.customer
		company_doc = frappe.get_doc("Company", company)

		mode_of_payment_doc = frappe.get_doc("Mode of Payment", mode_of_payment)
		paid_to_account = None
		for account in mode_of_payment_doc.accounts:
			if account.company == company:
				paid_to_account = account.default_account
				break
		if not paid_to_account:
			paid_to_account = company_doc.default_cash_account

		pe_data = {
			"doctype": "Payment Entry",
			"payment_type": "Receive",
			"party_type": "Customer",
			"party": customer,
			"company": company,
			"posting_date": nowdate(),
			"paid_amount": flt(payment_amount),
			"received_amount": flt(payment_amount),
			"source_exchange_rate": 1,
			"target_exchange_rate": 1,
			"party_account": get_customer_receivable_account(customer, company),
			"paid_to": paid_to_account,
			"mode_of_payment": mode_of_payment,
			"paid_from_account_currency": sales_invoice.currency,
			"paid_to_account_currency": sales_invoice.currency,
			"remarks": f"Partial payment for Sales Invoice {sales_invoice.name}",
			"references": [{
				"reference_doctype": "Sales Invoice",
				"reference_name": sales_invoice.name,
				"allocated_amount": flt(payment_amount),
			}],
		}

		paid_to_type = frappe.get_cached_value("Account", paid_to_account, "account_type")
		if paid_to_type == "Bank":
			pe_data["reference_no"] = f"POS-PP-{nowdate()}-{sales_invoice.name}"
			pe_data["reference_date"] = getdate(nowdate())

		pe_meta = frappe.get_meta("Payment Entry")
		if pe_meta.has_field("custom_pos_opening_entry") and opening_entry:
			pe_data["custom_pos_opening_entry"] = opening_entry
		if pe_meta.has_field("custom_pos_payment_type"):
			pe_data["custom_pos_payment_type"] = "Partial Payment"

		pe = frappe.get_doc(pe_data)
		pe.set_missing_values()
		pe.set_missing_ref_details(force=True)
		pe.insert(ignore_permissions=True)
		pe.submit()

		frappe.db.set_value("Payment Entry", pe.name, {
			"owner": original_user,
			"modified_by": original_user,
		}, update_modified=False)

		return pe

	except Exception as e:
		frappe.log_error(
			frappe.get_traceback(),
			f"Error creating partial payment entry for invoice {sales_invoice.name}",
		)
		raise e
	finally:
		frappe.set_user(original_user)


def get_customer_receivable_account(customer, company):
	"""Get customer's receivable account using ERPNext utility"""
	try:
		from erpnext.accounts.party import get_party_account

		return get_party_account("Customer", customer, company)
	except Exception as e:
		frappe.log_error(f"Error getting receivable account for customer {customer}: {e!s}")
		return frappe.db.get_value("Company", company, "default_receivable_account")


@frappe.whitelist()
def get_invoice_payment_status(invoice_name):
	"""
	Get detailed payment status for an invoice including GL balance.
	Useful for diagnosing discrepancies between displayed status and actual payment state.
	"""
	try:
		invoice = frappe.get_doc("Sales Invoice", invoice_name)
		
		# Get actual outstanding from GL Entries
		gl_outstanding = get_actual_outstanding_from_gl(invoice_name, invoice.company, invoice.customer)
		
		# Get linked Payment Entries
		payment_entries = frappe.get_all(
			"Payment Entry Reference",
			filters={
				"reference_doctype": "Sales Invoice",
				"reference_name": invoice_name,
			},
			fields=["parent", "allocated_amount"]
		)
		
		payment_details = []
		for pe_ref in payment_entries:
			pe = frappe.get_doc("Payment Entry", pe_ref.parent)
			payment_details.append({
				"name": pe.name,
				"posting_date": pe.posting_date,
				"paid_amount": pe.paid_amount,
				"allocated_amount": pe_ref.allocated_amount,
				"docstatus": pe.docstatus,
				"status": "Submitted" if pe.docstatus == 1 else ("Cancelled" if pe.docstatus == 2 else "Draft")
			})
		
		return {
			"success": True,
			"invoice_name": invoice_name,
			"invoice_status": invoice.status,
			"docstatus": invoice.docstatus,
			"grand_total": invoice.grand_total,
			"outstanding_amount_field": invoice.outstanding_amount,
			"gl_outstanding": gl_outstanding,
			"paid_amount_field": invoice.paid_amount,
			"has_discrepancy": abs(flt(invoice.outstanding_amount) - flt(gl_outstanding)) > 0.01,
			"payment_entries": payment_details,
			"total_allocated": sum(p.get("allocated_amount", 0) for p in payment_details if p.get("docstatus") == 1),
		}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"Error getting payment status for {invoice_name}")
		return {
			"success": False,
			"error": str(e)
		}


def get_actual_outstanding_from_gl(invoice_name, company, customer):
	"""
	Get the actual outstanding amount from GL Entries for a Sales Invoice.
	This is what ERPNext uses to validate Payment Entry allocations.
	"""
	try:
		from erpnext.accounts.party import get_party_account
		
		receivable_account = get_party_account("Customer", customer, company)
		
		# Get the balance from GL Entries
		gl_balance = frappe.db.sql("""
			SELECT SUM(debit) - SUM(credit) as balance
			FROM `tabGL Entry`
			WHERE voucher_type = 'Sales Invoice'
			AND voucher_no = %s
			AND account = %s
			AND is_cancelled = 0
		""", (invoice_name, receivable_account), as_dict=True)
		
		if gl_balance and gl_balance[0].balance is not None:
			return flt(gl_balance[0].balance)
		
		return 0.0
	except Exception as e:
		frappe.log_error(f"Error getting GL outstanding for {invoice_name}: {e}")
		return None


@frappe.whitelist()
def update_invoice_outstanding(invoice_name):
	"""
	Recalculate and update the outstanding amount for an invoice based on GL Entries.
	Use this to fix discrepancies between the displayed outstanding and actual GL balance.
	Also recalculates the invoice status.
	"""
	try:
		invoice = frappe.get_doc("Sales Invoice", invoice_name)
		
		if invoice.docstatus != 1:
			return {
				"success": False,
				"error": "Can only update outstanding for submitted invoices"
			}
		
		# Get actual outstanding from GL
		gl_outstanding = get_actual_outstanding_from_gl(invoice_name, invoice.company, invoice.customer)
		
		old_outstanding = invoice.outstanding_amount
		old_status = invoice.status
		
		# Update outstanding amount
		if gl_outstanding is not None:
			frappe.db.set_value("Sales Invoice", invoice_name, "outstanding_amount", gl_outstanding, update_modified=False)
		
		# Now recalculate and update the status using ERPNext's method
		# This is the proper way to update status in ERPNext
		try:
			from erpnext.accounts.doctype.sales_invoice.sales_invoice import update_linked_doc
			from erpnext.accounts.general_ledger import make_reverse_gl_entries
		except ImportError:
			pass
		
		# Use ERPNext's update_billing_status or set_status method
		invoice.reload()
		
		# Calculate the correct status based on outstanding amount
		new_status = calculate_invoice_status(invoice)
		
		# Update the status field
		if new_status != old_status:
			frappe.db.set_value("Sales Invoice", invoice_name, "status", new_status, update_modified=False)
		
		frappe.db.commit()
		
		# Reload one more time to get final state
		invoice.reload()
		
		return {
			"success": True,
			"message": f"Updated outstanding from {old_outstanding} to {gl_outstanding}, status from {old_status} to {invoice.status}",
			"old_outstanding": old_outstanding,
			"new_outstanding": gl_outstanding,
			"old_status": old_status,
			"new_status": invoice.status,
		}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"Error updating outstanding for {invoice_name}")
		return {
			"success": False,
			"error": str(e)
		}


def calculate_invoice_status(invoice):
	"""
	Calculate the correct status for a Sales Invoice based on ERPNext's logic.
	"""
	from frappe.utils import getdate, nowdate
	
	# Check if it's a return invoice
	if invoice.is_return:
		return "Return"
	
	# Check if cancelled
	if invoice.docstatus == 2:
		return "Cancelled"
	
	# Check if draft
	if invoice.docstatus == 0:
		return "Draft"
	
	# For submitted invoices (docstatus == 1)
	outstanding = flt(invoice.outstanding_amount)
	grand_total = flt(invoice.grand_total)
	
	# Check if there are any return invoices against this invoice
	has_return = frappe.db.exists("Sales Invoice", {
		"return_against": invoice.name,
		"docstatus": 1
	})
	
	if has_return:
		# If there's a return and still has outstanding, it's "Credit Note Issued"
		# If fully settled, it could be "Paid" or "Credit Note Issued"
		if outstanding <= 0:
			return "Credit Note Issued"
		else:
			return "Credit Note Issued"
	
	# No returns - check payment status
	if outstanding <= 0:
		return "Paid"
	elif outstanding < grand_total:
		# Partially paid
		# Check if overdue
		if invoice.due_date and getdate(invoice.due_date) < getdate(nowdate()):
			return "Overdue"
		return "Partly Paid"
	else:
		# Fully unpaid
		if invoice.due_date and getdate(invoice.due_date) < getdate(nowdate()):
			return "Overdue"
		return "Unpaid"


@frappe.whitelist()
def pay_unpaid_invoice(invoice_name, mode_of_payment, amount=None):
	"""
	Pay an unpaid invoice by creating a Payment Entry.
	This is used to settle credit sales.
	
	Args:
		invoice_name: Name of the Sales Invoice to pay
		mode_of_payment: Mode of Payment (e.g., "Cash", "Card", etc.)
		amount: Optional amount to pay. If not provided, pays the full outstanding amount.
	
	Returns:
		dict with success status, payment entry name, and updated invoice status
	"""
	try:
		# Get the sales invoice
		invoice = frappe.get_doc("Sales Invoice", invoice_name)
		
		# Validate invoice status
		if invoice.docstatus != 1:
			frappe.throw(f"Invoice {invoice_name} is not submitted")
		
		# Check actual GL outstanding (more accurate than the field value)
		gl_outstanding = get_actual_outstanding_from_gl(invoice_name, invoice.company, invoice.customer)
		
		# If there's a discrepancy, update the invoice first
		if gl_outstanding is not None and abs(flt(invoice.outstanding_amount) - flt(gl_outstanding)) > 0.01:
			frappe.db.set_value("Sales Invoice", invoice_name, "outstanding_amount", gl_outstanding, update_modified=False)
			invoice.reload()
			frappe.db.commit()
		
		# Now check if there's actually any outstanding amount
		actual_outstanding = gl_outstanding if gl_outstanding is not None else invoice.outstanding_amount
		
		if flt(actual_outstanding) <= 0:
			# Invoice is actually fully paid - update status and return helpful message
			return {
				"success": False,
				"error": f"Invoice {invoice_name} has no outstanding amount. The invoice has already been fully paid. Please refresh the page to see the updated status.",
				"already_paid": True,
				"gl_outstanding": gl_outstanding,
				"field_outstanding": invoice.outstanding_amount,
			}
		
		# Determine amount to pay
		payment_amount = flt(amount) if amount else flt(actual_outstanding)
		
		if payment_amount <= 0:
			frappe.throw("Payment amount must be greater than 0")
		
		if payment_amount > actual_outstanding:
			frappe.throw(f"Payment amount ({payment_amount}) cannot exceed outstanding amount ({actual_outstanding})")
		
		# Get company details
		company = invoice.company
		customer = invoice.customer
		company_doc = frappe.get_doc("Company", company)
		
		# Create Payment Entry
		payment_entry = frappe.new_doc("Payment Entry")
		payment_entry.payment_type = "Receive"
		payment_entry.party_type = "Customer"
		payment_entry.party = customer
		payment_entry.company = company
		payment_entry.posting_date = frappe.utils.nowdate()
		
		# Set amounts
		payment_entry.paid_amount = payment_amount
		payment_entry.received_amount = payment_amount
		payment_entry.source_exchange_rate = 1
		payment_entry.target_exchange_rate = 1
		
		# Set accounts
		payment_entry.party_account = get_customer_receivable_account(customer, company)
		
		# Get Mode of Payment account
		mode_of_payment_doc = frappe.get_doc("Mode of Payment", mode_of_payment)
		paid_to_account = None
		for account in mode_of_payment_doc.accounts:
			if account.company == company:
				paid_to_account = account.default_account
				break
		
		if not paid_to_account:
			paid_to_account = company_doc.default_cash_account
		
		payment_entry.paid_to = paid_to_account
		payment_entry.mode_of_payment = mode_of_payment
		
		# Set currencies
		payment_entry.paid_from_account_currency = invoice.currency
		payment_entry.paid_to_account_currency = invoice.currency
		
		# Link to the invoice
		payment_entry.append(
			"references",
			{
				"reference_doctype": "Sales Invoice",
				"reference_name": invoice_name,
				"allocated_amount": payment_amount,
			},
		)
		
		# Link to current POS Opening Entry if available (for cashier tracking)
		current_opening_entry = get_current_pos_opening_entry()
		if current_opening_entry:
			# Check if custom field exists on Payment Entry
			payment_entry_meta = frappe.get_meta("Payment Entry")
			if payment_entry_meta.has_field("custom_pos_opening_entry"):
				payment_entry.custom_pos_opening_entry = current_opening_entry
		
		# Save and submit
		payment_entry.save(ignore_permissions=True)
		payment_entry.submit()
		
		# Reload the invoice to get updated status
		invoice.reload()
		
		return {
			"success": True,
			"payment_entry": payment_entry.name,
			"payment_amount": payment_amount,
			"invoice_name": invoice_name,
			"new_outstanding_amount": invoice.outstanding_amount,
			"new_status": invoice.status,
			"pos_opening_entry": current_opening_entry,
		}
		
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"Error paying invoice {invoice_name}")
		return {
			"success": False,
			"error": str(e),
		}


@frappe.whitelist()
def returned_qty(customer, sales_invoice, item):
	"""
	Get total returned quantity for a specific item (item_code) against a given sales invoice.
	- sales_invoice should be the original invoice name.
	- item should be the item_code (not item name or child row name).
	Returns: {'total_returned_qty': <float>}
	"""
	values = {
		"customer": customer,
		"sales_invoice": sales_invoice,
		"item": item,
	}

	# Sum qty from Sales Invoice Items of return invoices that point to the original invoice
	result = frappe.db.sql(
		"""
		SELECT COALESCE(SUM(sii.qty), 0) AS total_returned_qty
		FROM `tabSales Invoice` si
		JOIN `tabSales Invoice Item` sii ON si.name = sii.parent
		WHERE si.is_return = 1
		  AND si.return_against = %(sales_invoice)s
		  AND sii.item_code = %(item)s
		  AND si.docstatus = 1
		  AND si.customer = %(customer)s
		""",
		values=values,
		as_dict=True,
	)

	total = abs(result[0]["total_returned_qty"]) if result else 0.0
	return {
		"total_returned_qty": round(float(total), 6)
	}  # Round to 6 decimal places to avoid precision issues


@frappe.whitelist()
def get_valid_sales_invoices(doctype, txt, searchfield, start, page_len, filters=None):
	"""Get valid sales invoices based on filters for multi-invoice returns"""
	filters = filters or {}

	customer = filters.get("customer")
	shipping_address = filters.get("shipping_address")
	item_code = filters.get("item_code")
	start_date = filters.get("start_date")

	if not customer or not item_code or not start_date:
		return []

	# Build dynamic conditions
	conditions = [
		"si.docstatus = 1",
		"si.is_return = 0",
		"si.custom_pos_opening_entry IS NOT NULL AND si.custom_pos_opening_entry != ''",
	]
	query_params = {
		"txt": f"%{txt}%",
		"start": start,
		"page_len": page_len,
	}

	if customer:
		conditions.append("si.customer = %(customer)s")
		query_params["customer"] = customer

	if shipping_address:
		conditions.append("si.shipping_address_name = %(shipping_address)s")
		query_params["shipping_address"] = shipping_address

	if item_code:
		conditions.append("sii.item_code = %(item_code)s")
		query_params["item_code"] = item_code

	if start_date:
		conditions.append("si.posting_date >= %(start_date)s")
		query_params["start_date"] = start_date

	conditions.append(
		"""
		(sii.qty + COALESCE((
			SELECT SUM(cd.qtr)
			FROM `tabCredit Details` cd
			JOIN `tabSales Invoice` rsi ON cd.parent = rsi.name
			WHERE cd.sales_invoice = si.name
			AND cd.item = sii.item_code
			AND rsi.customer = si.customer
			AND rsi.docstatus = 1
			AND rsi.status != 'Cancelled'
		), 0)) > 0
	"""
	)

	where_clause = " AND ".join(conditions)
	query = f"""
		SELECT DISTINCT si.name,si.posting_date,sii.qty
		FROM `tabSales Invoice` si
		JOIN `tabSales Invoice Item` sii ON si.name = sii.parent
		WHERE {where_clause}
		AND si.name LIKE %(txt)s
		LIMIT %(start)s, %(page_len)s
	"""

	return frappe.db.sql(query, query_params)


@frappe.whitelist()
def get_customer_invoices_for_return(customer, start_date=None, end_date=None, shipping_address=None):
	"""Get all invoices for a customer within date range that can be returned"""
	try:
		filters = {
			"customer": customer,
			"docstatus": 1,
			"is_return": 0,
			"status": ["!=", "Cancelled"],
			"custom_pos_opening_entry": ["!=", ""],
		}

		if start_date:
			filters["posting_date"] = [">=", start_date]
		if end_date:
			if "posting_date" in filters:
				filters["posting_date"] = ["between", [start_date, end_date]]
			else:
				filters["posting_date"] = ["<=", end_date]

		# Add shipping address filter if provided
		if shipping_address:
			filters["customer_address"] = shipping_address

		invoices = frappe.get_all(
			"Sales Invoice",
			filters=filters,
			fields=[
				"name",
				"posting_date",
				"posting_time",
				"customer",
				"grand_total",
				"paid_amount",
				"status",
			],
			order_by="posting_date desc",
		)

		# Batch fetch all items for all invoices
		invoice_names = [inv.name for inv in invoices]
		all_items = []
		if invoice_names:
			all_items = frappe.get_all(
				"Sales Invoice Item",
				filters={"parent": ["in", invoice_names]},
				fields=["parent", "item_code", "item_name", "qty", "rate", "amount"],
				order_by="parent, idx",
			)

		# Batch fetch all returned quantities for all items at once
		returned_qty_map = {}
		if all_items:
			item_codes = list(set([item.item_code for item in all_items]))
			_invoice_item_pairs = [(item.parent, item.item_code) for item in all_items]

			if item_codes:
				inv_placeholders = ",".join(["%s"] * len(invoice_names))
				item_placeholders = ",".join(["%s"] * len(item_codes))
				returns_query = f"""
					SELECT
						rsi.return_against as original_invoice,
						sii.item_code,
						COALESCE(SUM(ABS(sii.qty)), 0) as total_returned_qty
					FROM `tabSales Invoice` rsi
					JOIN `tabSales Invoice Item` sii ON rsi.name = sii.parent
					WHERE rsi.is_return = 1
					  AND rsi.return_against IN ({inv_placeholders})
					  AND sii.item_code IN ({item_placeholders})
					  AND rsi.docstatus = 1
					  AND rsi.customer = %s
					GROUP BY rsi.return_against, sii.item_code
				"""
				returns_data = frappe.db.sql(returns_query, (*invoice_names, *item_codes, customer), as_dict=True)
				returned_qty_map = {
					(row.original_invoice, row.item_code): row.total_returned_qty for row in returns_data
				}

		# Group items by invoice and calculate returned quantities
		invoice_items_map = {}
		for item in all_items:
			if item.parent not in invoice_items_map:
				invoice_items_map[item.parent] = []

			returned_qty_value = returned_qty_map.get((item.parent, item.item_code), 0)
			item.returned_qty = returned_qty_value
			item.available_qty = round(
				item.qty - returned_qty_value, 6
			)  # Round to 6 decimal places to avoid precision issues

			invoice_items_map[item.parent].append(item)

		# Assign items to invoices
		for invoice in invoices:
			invoice.items = invoice_items_map.get(invoice.name, [])

			# Get all payment methods from payment child table
			invoice_doc = frappe.get_doc("Sales Invoice", invoice.name)
			payment_methods = []
			if invoice_doc.payments:
				for payment in invoice_doc.payments:
					payment_methods.append(
						{"mode_of_payment": payment.mode_of_payment, "amount": payment.amount}
					)
			elif invoice_doc.status == "Draft":
				payment_methods = []
			else:
				# Check Payment Entry if invoice payments table is empty but invoice is paid
				if invoice_doc.status in ["Paid", "Partly Paid"] and not invoice_doc.payments:
					payment_entries = frappe.get_all(
						"Payment Entry Reference",
						filters={"reference_name": invoice_doc.name, "reference_doctype": "Sales Invoice"},
						fields=["parent", "allocated_amount"],
						parent_doctype="Payment Entry",
					)

					for pe_ref in payment_entries:
						payment_entry = frappe.get_doc("Payment Entry", pe_ref.parent)
						if payment_entry.docstatus == 1:
							payment_methods.append(
								{
									"mode_of_payment": payment_entry.mode_of_payment,
									"amount": pe_ref.allocated_amount,
								}
							)

			invoice.payment_methods = payment_methods
			# Keep backward compatibility - show first payment method or combined display
			# Logic: 
			# - If no payment methods and invoice is unpaid/overdue/pending → show "Credit"
			# - If no payment methods and invoice is paid → show "-" (edge case)
			# - If payment methods exist → show the payment method(s)
			unpaid_statuses = {"Unpaid", "Overdue", "Partly Paid", "Pending", "Draft"}
			if len(payment_methods) == 0:
				if invoice_doc.status in unpaid_statuses:
					invoice.payment_method = "Credit"
				else:
					invoice.payment_method = "-"
			elif len(payment_methods) == 1:
				invoice.payment_method = payment_methods[0]["mode_of_payment"]
			else:
				# Show combined payment methods like "Cash/Credit Card"
				invoice.payment_method = "/".join([pm["mode_of_payment"] for pm in payment_methods])

		return {"success": True, "data": invoices}

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Error fetching customer invoices for return")
		return {"success": False, "error": str(e)}


@frappe.whitelist()
def create_partial_return(
	invoice_name, return_items, payment_method=None, return_amount=None, expected_return_amount=None
):
	"""Create a partial return for selected items from an invoice with custom payment method"""

	try:
		if isinstance(return_items, str):
			return_items = json.loads(return_items)

		original_invoice = frappe.get_doc("Sales Invoice", invoice_name)

		if original_invoice.docstatus != 1:
			frappe.throw("Only submitted invoices can be returned.")

		if original_invoice.is_return:
			frappe.throw("This invoice is already a return.")

		# Create return invoice using the same approach as return_sales_invoice
		return_doc = get_mapped_doc(
			"Sales Invoice",
			invoice_name,
			{
				"Sales Invoice": {
					"doctype": "Sales Invoice",
					"field_map": {"name": "return_against"},
					"validation": {"docstatus": ["=", 1]},
				},
				"Sales Invoice Item": {
					"doctype": "Sales Invoice Item",
					"field_map": {"name": "prevdoc_detail_docname"},
				},
			},
		)

		return_doc.is_return = 1
		return_doc.posting_date = frappe.utils.nowdate()
		return_doc.custom_delivery_date = frappe.utils.nowdate()

		# Set the current POS opening entry
		current_opening_entry = get_current_pos_opening_entry()
		if current_opening_entry:
			return_doc.custom_pos_opening_entry = current_opening_entry

		# Ensure no original round-off leaks into partial return
		return_doc.custom_roundoff_amount = 0
		return_doc.custom_base_roundoff_amount = 0
		return_doc.custom_roundoff_account = get_writeoff_account()

		# Filter items to only include selected ones with return quantities
		filtered_items = []
		for return_item in return_items:
			if return_item.get("return_qty", 0) > 0:
				for item in return_doc.items:
					if item.item_code == return_item["item_code"]:
						item.qty = -abs(return_item["return_qty"])
						filtered_items.append(item)
						break

		return_doc.items = filtered_items

		# No custom roundoff mirroring for now

		# Clear existing payments
		return_doc.payments = []

		# Calculate total returned amount (baseline expected refund)
		# Prefer client-provided expected amount; fallback to backend computation
		if expected_return_amount is not None:
			try:
				total_returned_amount = flt(expected_return_amount, return_doc.precision("grand_total") or 2)
			except Exception:
				total_returned_amount = sum(abs(item.qty * item.rate) for item in return_doc.items)
		else:
			total_returned_amount = sum(abs(item.qty * item.rate) for item in return_doc.items)

		final_return_amount = return_amount if return_amount is not None else total_returned_amount

		final_payment_method = payment_method if payment_method else "Cash"

		# Optionally persist the auto-calculated expected refund if a custom field exists
		try:
			_si_meta = frappe.get_meta("Sales Invoice")
			if any(df.fieldname == "custom_expected_refund_amount" for df in _si_meta.fields):
				return_doc.custom_expected_refund_amount = flt(
					total_returned_amount, return_doc.precision("grand_total") or 2
				)
		except Exception:
			pass

		# If cashier entered a custom refund (partial return), push the difference to round-off on the return
		try:
			# Only apply when there's a meaningful difference
			prec = return_doc.precision("grand_total") or 2
			_diff = flt(total_returned_amount, prec) - flt(final_return_amount, prec)
			if abs(_diff) > (10 ** (-prec)) / 2:
				# For returns, custom_calculate_totals ADDS custom_roundoff_amount to grand_total.
				# This is a NEW write-off specific to this partial return. Do not accumulate.
				return_doc.custom_roundoff_amount = 0
				return_doc.custom_base_roundoff_amount = 0
				return_doc.custom_roundoff_amount = abs(flt(_diff, prec))
				return_doc.custom_roundoff_account = get_writeoff_account()
				return_doc.custom_base_roundoff_amount = flt(
					return_doc.custom_roundoff_amount * (return_doc.conversion_rate or 1), prec
				)
		except Exception:
			pass
		# Handle write-off for full returns
		original_grand_total = abs(original_invoice.grand_total)
		requested_return = abs(final_return_amount)
		is_full_return = abs(requested_return - original_grand_total) < 0.01

		if (
			is_full_return
			and hasattr(original_invoice, "custom_roundoff_amount")
			and original_invoice.custom_roundoff_amount
		):
			# For full returns, mirror the original write-off to make grand total = paid amount
			return_doc.custom_roundoff_amount = abs(original_invoice.custom_roundoff_amount)
			return_doc.custom_base_roundoff_amount = abs(original_invoice.custom_base_roundoff_amount)
			return_doc.custom_roundoff_account = getattr(
				original_invoice, "custom_roundoff_account", get_writeoff_account()
			)

			# Adjust payment amount to match the paid amount (after write-off)
			original_paid_amount = original_invoice.paid_amount or original_invoice.grand_total
			final_return_amount = abs(original_paid_amount)

		if final_return_amount > 0:
			return_doc.append(
				"payments",
				{
					"mode_of_payment": final_payment_method,
					"amount": -abs(final_return_amount),
				},
			)
		print("Mko 3", -abs(final_return_amount))
		# Recalculate totals (payment amount stays as user entered)
		try:
			return_doc.calculate_taxes_and_totals()
		except Exception:
			pass

		return_doc.save(ignore_permissions=True)
		return_doc.submit()

		return {
			"success": True,
			"return_invoice": return_doc.name,
			"message": f"Return created successfully: {return_doc.name} (Payment: {final_payment_method})",
		}

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Partial Return Error")
		return {"success": False, "message": str(e)}


@frappe.whitelist()
def create_multi_invoice_return(return_data):
	"""Create multiple return invoices for items from different invoices"""
	try:
		if isinstance(return_data, str):
			return_data = json.loads(return_data)

		invoice_returns = return_data.get("invoice_returns", [])

		created_returns = []

		for _i, invoice_return in enumerate(invoice_returns):
			invoice_name = invoice_return.get("invoice_name")
			return_items = invoice_return.get("return_items", [])
			payment_method = invoice_return.get("payment_method")
			return_amount = invoice_return.get("return_amount")

			if return_items:
				# Call create_partial_return with payment method and return amount
				result = create_partial_return(
					invoice_name, return_items, payment_method=payment_method, return_amount=return_amount
				)
				if result.get("success"):
					created_returns.append(result.get("return_invoice"))
				else:
					frappe.log_error(f"Failed to create return for {invoice_name}: {result.get('message')}")

		return {
			"success": True,
			"created_returns": created_returns,
			"message": f"Created {len(created_returns)} return invoices successfully",
		}

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Multi Invoice Return Error")
		return {"success": False, "message": str(e)}


@frappe.whitelist()
def delete_draft_invoice(invoice_id):
	"""
	Delete a draft sales invoice.
	Only allows deletion of Draft status invoices.
	"""
	try:
		# Get the invoice document
		invoice_doc = frappe.get_doc("Sales Invoice", invoice_id)

		if invoice_doc.status != "Draft":
			return {
				"success": False,
				"error": f"Cannot delete invoice {invoice_id}. Only Draft invoices can be deleted. Current status: {invoice_doc.status}",
			}

		invoice_doc.delete()

		return {
			"success": True,
			"message": f"Draft invoice {invoice_id} deleted successfully",
		}

	except frappe.DoesNotExistError:
		return {"success": False, "error": f"Invoice {invoice_id} not found"}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"Error deleting draft invoice {invoice_id}")
		return {"success": False, "error": str(e)}


@frappe.whitelist()
def submit_draft_invoice(invoice_id):
	"""
	Submit a draft sales invoice directly without payment dialog.
	This converts a draft invoice to submitted status.
	"""
	try:
		invoice_doc = frappe.get_doc("Sales Invoice", invoice_id)

		if invoice_doc.status != "Draft":
			return {
				"success": False,
				"error": f"Cannot submit invoice {invoice_id}. Only Draft invoices can be submitted. Current status: {invoice_doc.status}",
			}

		_patch_expired_batch_bypass(invoice_doc)
		try:
			invoice_doc.submit()
		finally:
			_unpatch_expired_batch_bypass(invoice_doc)

		return {
			"success": True,
			"message": f"Draft invoice {invoice_id} submitted successfully",
			"invoice_name": invoice_doc.name,
			"invoice": invoice_doc,
		}

	except frappe.DoesNotExistError:
		return {"success": False, "error": f"Invoice {invoice_id} not found"}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"Error submitting draft invoice {invoice_id}")
		return {"success": False, "error": str(e)}
