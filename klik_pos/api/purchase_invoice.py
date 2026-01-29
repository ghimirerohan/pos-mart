"""
Purchase Invoice API for klik_pos.
Handles fetching, viewing, paying, and returning purchase invoices.
"""

import frappe
from frappe import _
from frappe.model.mapper import get_mapped_doc
from frappe.utils import flt


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
def get_purchase_invoices(limit=100, start=0, search="", user_name=None):
	"""
	Get purchase invoices with proper filtering.

	Args:
		limit: Number of invoices to fetch
		start: Starting offset for pagination
		search: Search term for filtering
		user_name: Filter by user name (full name). If provided, only returns invoices for that user.
	"""
	try:
		# Get user IDs for user filter if user_name is provided
		user_ids = None
		if user_name and user_name != "all":
			user_ids = _get_user_ids_by_full_name(user_name)
			if not user_ids:
				# No users found with this name, return empty result
				return {"success": True, "data": [], "total_count": 0}

		filters, fields = _build_filters_and_fields(user_ids=user_ids)

		# Build search filters
		or_filters = _build_search_filters(search)

		invoices = frappe.get_all(
			"Purchase Invoice",
			filters=filters,
			or_filters=or_filters,
			fields=fields,
			order_by="modified desc",
			limit=limit,
			start=start,
		)

		count_rows = frappe.get_all(
			"Purchase Invoice", filters=filters, or_filters=or_filters, fields=["count(name) as total"]
		)
		total_count = count_rows[0].total if count_rows else 0

		# Batch fetch related data
		invoice_names = [inv.name for inv in invoices]
		user_ids_list = list(set([inv.owner for inv in invoices]))

		user_names_map = _batch_fetch_user_names(user_ids_list)
		payment_methods_map = _batch_fetch_payment_methods(invoice_names)
		items_map = _batch_fetch_items(invoice_names)

		# Process and enrich invoices
		_process_invoices(invoices, user_names_map, payment_methods_map, items_map)

		return {"success": True, "data": invoices, "total_count": total_count}

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Error fetching purchase invoices")
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


def _build_filters_and_fields(user_ids=None):
	"""Build filters and fields list for purchase invoice query.

	Args:
		user_ids: List of user IDs to filter by. If provided, only returns invoices for these users.
	"""
	filters = {}

	# Build fields list
	fields = [
		"name",
		"posting_date",
		"posting_time",
		"owner",
		"supplier",
		"supplier_name",
		"base_grand_total",
		"base_rounded_total",
		"status",
		"discount_amount",
		"total_taxes_and_charges",
		"currency",
		"company",
		"outstanding_amount",
		"paid_amount",
		"is_return",
		"return_against",
		"is_paid",
		"mode_of_payment",  # For invoices paid directly at creation (is_paid=1)
	]

	# Add user filter if provided
	if user_ids:
		if len(user_ids) == 1:
			filters["owner"] = user_ids[0]
		else:
			filters["owner"] = ["in", user_ids]
		frappe.logger().info(f"Filtering by user IDs: {user_ids}")

	return filters, fields


def _build_search_filters(search):
	"""Build OR filters for search functionality."""
	if not search or not search.strip():
		return None

	search_term = search.strip()
	return [
		["name", "like", f"%{search_term}%"],
		["supplier_name", "like", f"%{search_term}%"],
		["supplier", "like", f"%{search_term}%"],
	]


def _batch_fetch_user_names(user_ids):
	"""Batch fetch user names for given user IDs."""
	if not user_ids:
		return {}

	user_query = """
		SELECT name, full_name
		FROM `tabUser`
		WHERE name IN ({})
	""".format(",".join([f"'{uid}'" for uid in user_ids]))
	user_results = frappe.db.sql(user_query, as_dict=True)
	return {user.name: user.full_name or user.name for user in user_results}


def _batch_fetch_payment_methods(invoice_names):
	"""Batch fetch payment methods for given invoices from Payment Entry references."""
	if not invoice_names:
		return {}

	# For Purchase Invoices, payments are tracked via Payment Entry references
	payment_query = """
		SELECT per.reference_name as parent, pe.mode_of_payment, per.allocated_amount as amount
		FROM `tabPayment Entry Reference` per
		JOIN `tabPayment Entry` pe ON pe.name = per.parent
		WHERE per.reference_doctype = 'Purchase Invoice'
		AND per.reference_name IN ({})
		AND pe.docstatus = 1
	""".format(",".join([f"'{name}'" for name in invoice_names]))
	payment_results = frappe.db.sql(payment_query, as_dict=True)

	# Group by parent invoice
	payment_methods_map = {}
	for payment in payment_results:
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

	items_query = """
		SELECT parent, item_code, item_name, qty, rate, amount, description
		FROM `tabPurchase Invoice Item`
		WHERE parent IN ({})
	""".format(",".join([f"'{name}'" for name in invoice_names]))
	items_results = frappe.db.sql(items_query, as_dict=True)

	# Group by parent invoice
	items_map = {}
	for item in items_results:
		if item.parent not in items_map:
			items_map[item.parent] = []
		items_map[item.parent].append(
			{
				"item_code": item.item_code,
				"item_name": item.item_name,
				"qty": item.qty,
				"rate": item.rate,
				"amount": item.amount,
				"description": item.description,
				"quantity": item.qty,
			}
		)

	return items_map


def _process_invoices(invoices, user_names_map, payment_methods_map, items_map):
	"""Process and enrich invoices with related data."""
	# Define unpaid statuses - invoices with these statuses and no payment methods should show "Credit"
	unpaid_statuses = {"Unpaid", "Overdue", "Partly Paid", "Pending", "Draft"}

	for inv in invoices:
		# Set user name
		inv["user_name"] = user_names_map.get(inv.owner, inv.owner)

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

		# Set payment methods from Payment Entry references
		payment_methods = payment_methods_map.get(inv.name, [])
		
		# Store the original mode_of_payment from the invoice (for invoices paid directly at creation)
		invoice_direct_mode_of_payment = inv.get("mode_of_payment")
		
		inv["payment_methods"] = payment_methods

		# Set the display mode_of_payment field
		# Logic: 
		# 1. If payment methods from Payment Entry exist → show them
		# 2. Else if invoice has mode_of_payment set (paid at creation with is_paid=1) → show it
		# 3. Else if invoice is unpaid/overdue/pending → show "Credit"
		# 4. Else fallback to "-"
		if len(payment_methods) > 0:
			# Payment Entry references found
			if len(payment_methods) == 1:
				inv["mode_of_payment"] = payment_methods[0]["mode_of_payment"]
			else:
				inv["mode_of_payment"] = "/".join([pm["mode_of_payment"] for pm in payment_methods])
		elif invoice_direct_mode_of_payment:
			# Invoice was paid directly at creation (is_paid=1 with mode_of_payment set)
			inv["mode_of_payment"] = invoice_direct_mode_of_payment
		else:
			# No payment method found - check status
			invoice_status = inv.get("status", "")
			if invoice_status in unpaid_statuses:
				inv["mode_of_payment"] = "Credit"
			else:
				# Paid invoice without any payment methods found (edge case) - show "-"
				inv["mode_of_payment"] = "-"

		# Set items and calculate return data
		items = items_map.get(inv.name, [])

		# Only calculate return data for Debit Note Issued invoices
		if inv.get("status") == "Debit Note Issued":
			_calculate_return_quantities(inv, items)
		else:
			for item in items:
				item["returned_qty"] = 0
				item["available_qty"] = item["qty"]

		inv["items"] = items


def _calculate_return_quantities(invoice, items):
	"""Calculate return quantities for debit note invoices."""
	item_codes = [item["item_code"] for item in items]
	if not item_codes:
		return

	returns_query = """
		SELECT pii.item_code, COALESCE(SUM(ABS(pii.qty)), 0) as total_returned_qty
		FROM `tabPurchase Invoice` pi
		JOIN `tabPurchase Invoice Item` pii ON pi.name = pii.parent
		WHERE pi.is_return = 1
		  AND pi.return_against = %s
		  AND pii.item_code IN ({})
		  AND pi.docstatus = 1
		  AND pi.supplier = %s
		GROUP BY pii.item_code
	""".format(",".join([f"'{code}'" for code in item_codes]))

	returns_data = frappe.db.sql(returns_query, (invoice.name, invoice.supplier), as_dict=True)
	returned_qty_map = {row.item_code: row.total_returned_qty for row in returns_data}

	# Update items with return data
	for item in items:
		returned_qty_value = returned_qty_map.get(item["item_code"], 0)
		item["returned_qty"] = round(float(returned_qty_value), 6)
		item["available_qty"] = round(item["qty"] - returned_qty_value, 6)


@frappe.whitelist(allow_guest=True)
def get_purchase_invoice_details(invoice_id):
	"""
	Main function to fetch complete purchase invoice details.
	"""
	try:
		invoice = frappe.get_doc("Purchase Invoice", invoice_id)
		invoice_data = invoice.as_dict()

		# Get items with return data
		items = _get_invoice_items_with_returns(invoice_id, invoice.supplier)

		# Get address and supplier information
		address_data = _get_address_and_supplier_info(invoice)

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

		# Get user full name
		user_name = frappe.db.get_value(
			"User", invoice_data.get("owner"), "full_name"
		) or invoice_data.get("owner")
		invoice_data["user_name"] = user_name

		# Get payment method from Payment Entry references
		payment_methods = _get_payment_methods_for_invoice(invoice_id)
		invoice_data["payment_methods"] = payment_methods if payment_methods else []
		
		# Store the original mode_of_payment from the invoice (for invoices paid directly at creation)
		invoice_direct_mode_of_payment = invoice.mode_of_payment
		
		# Set mode_of_payment based on payment methods and invoice status
		# Logic: 
		# 1. If payment methods from Payment Entry exist → show them
		# 2. Else if invoice has mode_of_payment set (paid at creation with is_paid=1) → show it
		# 3. Else if invoice is unpaid/overdue/pending → show "Credit"
		# 4. Else fallback to "-"
		unpaid_statuses = {"Unpaid", "Overdue", "Partly Paid", "Pending", "Draft"}
		if payment_methods:
			if len(payment_methods) == 1:
				invoice_data["mode_of_payment"] = payment_methods[0]["mode_of_payment"]
			else:
				invoice_data["mode_of_payment"] = "/".join([pm["mode_of_payment"] for pm in payment_methods])
		elif invoice_direct_mode_of_payment:
			# Invoice was paid directly at creation (is_paid=1 with mode_of_payment set)
			invoice_data["mode_of_payment"] = invoice_direct_mode_of_payment
		else:
			invoice_status = invoice_data.get("status", "")
			if invoice_status in unpaid_statuses:
				invoice_data["mode_of_payment"] = "Credit"
			else:
				invoice_data["mode_of_payment"] = "-"

		return {
			"success": True,
			"data": {
				**invoice_data,
				"items": items,
				**address_data,
			},
		}

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"Error fetching purchase invoice {invoice_id}")
		return {"success": False, "error": str(e)}


def _get_payment_methods_for_invoice(invoice_name):
	"""Get payment methods for a specific invoice from Payment Entry references."""
	payment_query = """
		SELECT pe.mode_of_payment, per.allocated_amount as amount
		FROM `tabPayment Entry Reference` per
		JOIN `tabPayment Entry` pe ON pe.name = per.parent
		WHERE per.reference_doctype = 'Purchase Invoice'
		AND per.reference_name = %s
		AND pe.docstatus = 1
	"""
	return frappe.db.sql(payment_query, (invoice_name,), as_dict=True)


def _get_invoice_items_with_returns(invoice_id, supplier):
	"""
	Fetch invoice items and calculate returned/available quantities.
	"""
	# Batch fetch all items for this invoice
	items_query = """
		SELECT item_code, item_name, qty, rate, amount, description
		FROM `tabPurchase Invoice Item`
		WHERE parent = %s
	"""
	items_data = frappe.db.sql(items_query, (invoice_id,), as_dict=True)

	# Batch fetch return quantities for all items at once
	item_codes = [item.item_code for item in items_data]
	returned_qty_map = {}

	if item_codes:
		returns_query = """
			SELECT pii.item_code, COALESCE(SUM(ABS(pii.qty)), 0) as total_returned_qty
			FROM `tabPurchase Invoice` pi
			JOIN `tabPurchase Invoice Item` pii ON pi.name = pii.parent
			WHERE pi.is_return = 1
			  AND pi.return_against = %s
			  AND pii.item_code IN ({})
			  AND pi.docstatus = 1
			  AND pi.supplier = %s
			GROUP BY pii.item_code
		""".format(",".join([f"'{code}'" for code in item_codes]))

		returns_data = frappe.db.sql(returns_query, (invoice_id, supplier), as_dict=True)
		returned_qty_map = {row.item_code: row.total_returned_qty for row in returns_data}

	# Build items list with return data
	items = []
	for item in items_data:
		returned_qty = returned_qty_map.get(item.item_code, 0)
		items.append({
			"item_code": item.item_code,
			"item_name": item.item_name,
			"qty": item.qty,
			"rate": item.rate,
			"amount": item.amount,
			"description": item.description,
			"returned_qty": round(float(returned_qty), 6),
			"available_qty": round(item.qty - returned_qty, 6),
		})

	return items


def _get_address_and_supplier_info(invoice):
	"""Fetch address and supplier information for the invoice."""
	result = {}

	# Get supplier address
	if invoice.supplier_address:
		try:
			address_doc = frappe.get_doc("Address", invoice.supplier_address)
			result["supplier_address_doc"] = {
				"address_line1": address_doc.address_line1,
				"address_line2": address_doc.address_line2,
				"city": address_doc.city,
				"state": address_doc.state,
				"pincode": address_doc.pincode,
				"country": address_doc.country,
				"phone": address_doc.phone,
				"email_id": address_doc.email_id,
			}
		except Exception:
			result["supplier_address_doc"] = None
	else:
		result["supplier_address_doc"] = None

	# Get company address
	if invoice.company:
		try:
			company_doc = frappe.get_doc("Company", invoice.company)
			if company_doc.company_address:
				company_address = frappe.get_doc("Address", company_doc.company_address)
				result["company_address_doc"] = {
					"address_line1": company_address.address_line1,
					"city": company_address.city,
					"state": company_address.state,
					"country": company_address.country,
					"phone": company_address.phone,
				}
			else:
				result["company_address_doc"] = None
		except Exception:
			result["company_address_doc"] = None

	return result


def get_supplier_payable_account(supplier, company):
	"""Get the payable account for a supplier."""
	# First check if supplier has a specific account set
	supplier_doc = frappe.get_doc("Supplier", supplier)
	if supplier_doc.accounts:
		for account in supplier_doc.accounts:
			if account.company == company:
				return account.account

	# Fallback to company default payable account
	company_doc = frappe.get_doc("Company", company)
	return company_doc.default_payable_account


@frappe.whitelist()
def pay_purchase_invoice(invoice_name, mode_of_payment, amount=None):
	"""
	Pay a purchase invoice by creating a Payment Entry.
	This is used to settle credit purchases.
	
	Args:
		invoice_name: Name of the Purchase Invoice to pay
		mode_of_payment: Mode of Payment (e.g., "Cash", "Card", etc.)
		amount: Optional amount to pay. If not provided, pays the full outstanding amount.
	
	Returns:
		dict with success status, payment entry name, and updated invoice status
	"""
	try:
		# Get the purchase invoice
		invoice = frappe.get_doc("Purchase Invoice", invoice_name)
		
		# Validate invoice status
		if invoice.docstatus != 1:
			frappe.throw(f"Invoice {invoice_name} is not submitted")
		
		if invoice.outstanding_amount <= 0:
			frappe.throw(f"Invoice {invoice_name} has no outstanding amount")
		
		# Determine amount to pay
		payment_amount = flt(amount) if amount else flt(invoice.outstanding_amount)
		
		if payment_amount <= 0:
			frappe.throw("Payment amount must be greater than 0")
		
		if payment_amount > invoice.outstanding_amount:
			frappe.throw(f"Payment amount ({payment_amount}) cannot exceed outstanding amount ({invoice.outstanding_amount})")
		
		# Get company details
		company = invoice.company
		supplier = invoice.supplier
		company_doc = frappe.get_doc("Company", company)
		
		# Create Payment Entry
		payment_entry = frappe.new_doc("Payment Entry")
		payment_entry.payment_type = "Pay"  # "Pay" for purchase invoices (vs "Receive" for sales)
		payment_entry.party_type = "Supplier"  # "Supplier" (vs "Customer" for sales)
		payment_entry.party = supplier
		payment_entry.company = company
		payment_entry.posting_date = frappe.utils.nowdate()
		
		# Set amounts
		payment_entry.paid_amount = payment_amount
		payment_entry.received_amount = payment_amount
		payment_entry.source_exchange_rate = 1
		payment_entry.target_exchange_rate = 1
		
		# Set accounts - for purchases, we pay FROM bank/cash TO supplier
		payment_entry.party_account = get_supplier_payable_account(supplier, company)
		
		# Get Mode of Payment account (the account we pay FROM)
		mode_of_payment_doc = frappe.get_doc("Mode of Payment", mode_of_payment)
		paid_from_account = None
		for account in mode_of_payment_doc.accounts:
			if account.company == company:
				paid_from_account = account.default_account
				break
		
		if not paid_from_account:
			paid_from_account = company_doc.default_cash_account
		
		payment_entry.paid_from = paid_from_account  # "paid_from" for payments (vs "paid_to" for receipts)
		payment_entry.mode_of_payment = mode_of_payment
		
		# Set currencies
		payment_entry.paid_from_account_currency = invoice.currency
		payment_entry.paid_to_account_currency = invoice.currency
		
		# Link to the invoice
		payment_entry.append(
			"references",
			{
				"reference_doctype": "Purchase Invoice",  # "Purchase Invoice" (vs "Sales Invoice")
				"reference_name": invoice_name,
				"allocated_amount": payment_amount,
			},
		)
		
		# Link to current POS Opening Entry if available (for tracking)
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
			"new_status": invoice.status,
			"outstanding_amount": invoice.outstanding_amount,
			"message": f"Payment of {payment_amount} made successfully"
		}
		
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"Error paying purchase invoice {invoice_name}")
		return {"success": False, "error": str(e)}


@frappe.whitelist()
def return_purchase_invoice(invoice_name):
	"""
	Create a return (debit note) for a purchase invoice.
	
	Args:
		invoice_name: Name of the Purchase Invoice to return
		
	Returns:
		dict with success status and return invoice name
	"""
	try:
		original_invoice = frappe.get_doc("Purchase Invoice", invoice_name)

		if original_invoice.docstatus != 1:
			frappe.throw("Only submitted invoices can be returned.")

		if original_invoice.is_return:
			frappe.throw("This invoice is already a return.")

		# Create return document using mapped_doc
		return_doc = get_mapped_doc(
			"Purchase Invoice",
			invoice_name,
			{
				"Purchase Invoice": {
					"doctype": "Purchase Invoice",
					"field_map": {"name": "return_against"},
					"validation": {"docstatus": ["=", 1]},
				},
				"Purchase Invoice Item": {
					"doctype": "Purchase Invoice Item",
					"field_map": {"name": "purchase_invoice_item"},
				},
			},
		)

		return_doc.is_return = 1
		return_doc.posting_date = frappe.utils.nowdate()

		# Negate quantities for return
		for item in return_doc.items:
			item.qty = -abs(item.qty)

		return_doc.save(ignore_permissions=True)
		return_doc.submit()

		return {
			"success": True,
			"return_invoice": return_doc.name,
			"message": f"Return invoice {return_doc.name} created successfully"
		}

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"Error returning purchase invoice {invoice_name}")
		return {"success": False, "error": str(e)}


@frappe.whitelist()
def delete_draft_purchase_invoice(invoice_id):
	"""
	Delete a draft purchase invoice.
	
	Args:
		invoice_id: Name of the Purchase Invoice to delete
		
	Returns:
		dict with success status
	"""
	try:
		invoice = frappe.get_doc("Purchase Invoice", invoice_id)
		
		if invoice.docstatus != 0:
			frappe.throw("Only draft invoices can be deleted.")
		
		frappe.delete_doc("Purchase Invoice", invoice_id, ignore_permissions=True)
		
		return {
			"success": True,
			"message": f"Draft invoice {invoice_id} deleted successfully"
		}
		
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"Error deleting purchase invoice {invoice_id}")
		return {"success": False, "error": str(e)}


@frappe.whitelist()
def create_purchase_invoice(data):
	"""
	Create and submit a purchase invoice with stock update.
	
	Args:
		data: Dict containing:
			- supplier: {id: supplier_name}
			- items: [{id, quantity, purchase_price, selling_price, original_purchase_price, original_selling_price, uom, batch, serial}]
			- paymentMethods: [{mode_of_payment, amount}]
			- isCreditPurchase: bool
			- taxTemplate: str (optional)
			- attachment: {file_url} (optional)
	"""
	import json
	from datetime import datetime, timedelta
	from frappe.utils import nowdate, nowtime
	from klik_pos.klik_pos.utils import get_current_pos_profile
	
	try:
		import time
		start_time = time.time()

		if isinstance(data, str):
			data = json.loads(data)

		# Validate required fields
		supplier_data = data.get("supplier", {})
		supplier = supplier_data.get("id") if isinstance(supplier_data, dict) else supplier_data
		items = data.get("items", [])
		payment_methods = data.get("paymentMethods", [])
		is_credit_purchase = data.get("isCreditPurchase", False)
		tax_template = data.get("taxTemplate")
		attachment_url = data.get("attachment", {}).get("file_url") if data.get("attachment") else None

		if not supplier:
			frappe.throw(_("Supplier is required"))
		if not items or len(items) == 0:
			frappe.throw(_("At least one item is required"))

		# Validate supplier exists
		if not frappe.db.exists("Supplier", supplier):
			frappe.throw(_("Supplier '{0}' does not exist").format(supplier))

		# Get POS profile for warehouse and company
		pos_profile = get_current_pos_profile()

		# Build purchase invoice document
		doc = frappe.new_doc("Purchase Invoice")
		doc.supplier = supplier
		doc.company = pos_profile.company
		doc.posting_date = nowdate()
		doc.posting_time = nowtime()
		doc.set_posting_time = 1
		doc.currency = frappe.db.get_value("Company", pos_profile.company, "default_currency")
		doc.conversion_rate = 1.0

		# CRITICAL: Always update stock for purchase invoices in POS
		doc.update_stock = 1
		doc.set_warehouse = pos_profile.warehouse

		# Set taxes if provided
		if tax_template:
			doc.taxes_and_charges = tax_template

		# Get default expense account
		company_doc = frappe.get_doc("Company", pos_profile.company)
		default_expense_account = company_doc.default_expense_account

		# Add items
		items_with_price_changes = []
		for item in items:
			item_code = item.get("id") or item.get("item_code")
			quantity = item.get("quantity") or item.get("qty", 1)
			purchase_price = item.get("purchase_price") or item.get("rate", 0)
			selling_price = item.get("selling_price", 0)
			original_purchase_price = item.get("original_purchase_price", purchase_price)
			original_selling_price = item.get("original_selling_price", selling_price)
			uom = item.get("uom")
			batch = item.get("batch")
			serial = item.get("serial")

			# Validate item exists
			if not frappe.db.exists("Item", item_code):
				frappe.throw(_("Item '{0}' does not exist").format(item_code))

			item_doc = frappe.get_doc("Item", item_code)

			item_data = {
				"item_code": item_code,
				"qty": quantity,
				"rate": purchase_price,
				"warehouse": pos_profile.warehouse,
				"expense_account": default_expense_account,
			}

			# Add UOM if provided
			if uom:
				item_data["uom"] = uom
			else:
				item_data["uom"] = item_doc.stock_uom

			# Add batch if item has batch tracking
			if batch and item_doc.has_batch_no:
				item_data["batch_no"] = batch

			# Add serial numbers if item has serial tracking
			if serial and item_doc.has_serial_no:
				item_data["serial_no"] = serial

			doc.append("items", item_data)

			# Track ALL items for price update check
			# The update function will determine if records need to be created/updated
			items_with_price_changes.append({
				"item_code": item_code,
				"purchase_price": purchase_price,
				"selling_price": selling_price,
				"original_purchase_price": original_purchase_price,
				"original_selling_price": original_selling_price,
				"uom": item_data["uom"],
			})

		# Handle payment
		if is_credit_purchase:
			# Credit purchase - no payment, full outstanding
			doc.is_paid = 0
		else:
			# Paid purchase
			total_payment = sum(flt(pm.get("amount", 0)) for pm in payment_methods)
			if total_payment > 0:
				doc.is_paid = 1
				
				# Set mode_of_payment and cash_bank_account - required when is_paid = 1
				primary_mode = payment_methods[0].get("mode_of_payment", "Cash")
				doc.mode_of_payment = primary_mode  # Store payment method on invoice for display
				
				try:
					mode_of_payment_doc = frappe.get_doc("Mode of Payment", primary_mode)
					cash_bank_account = None
					
					for account in mode_of_payment_doc.accounts:
						if account.company == pos_profile.company:
							cash_bank_account = account.default_account
							break
					
					if not cash_bank_account:
						cash_bank_account = company_doc.default_cash_account
					
					if cash_bank_account:
						doc.cash_bank_account = cash_bank_account
				except Exception as e:
					frappe.log_error(f"Error getting cash/bank account: {e!s}")

		# Save and submit the invoice
		try:
			doc.save(ignore_permissions=True)
		except Exception as e:
			frappe.log_error(frappe.get_traceback(), f"Error saving purchase invoice: {e!s}")
			frappe.throw(_("Error saving purchase invoice: {0}").format(str(e)))

		try:
			doc.submit()
		except Exception as e:
			frappe.log_error(frappe.get_traceback(), f"Error submitting purchase invoice {doc.name}: {e!s}")
			frappe.throw(_("Error submitting purchase invoice: {0}").format(str(e)))

		# Create payment entry if not credit purchase and has payment methods
		payment_entry = None
		if not is_credit_purchase and payment_methods:
			total_payment = sum(flt(pm.get("amount", 0)) for pm in payment_methods)
			if total_payment > 0:
				# Use the first payment method for the payment entry
				primary_mode = payment_methods[0].get("mode_of_payment", "Cash")
				try:
					payment_entry = _create_purchase_payment_entry(doc, primary_mode, total_payment)
				except Exception as e:
					frappe.log_error(frappe.get_traceback(), f"Payment Entry Error for {doc.name}")

		# Update Item Prices if any changed
		price_update_results = []
		if items_with_price_changes:
			for item_change in items_with_price_changes:
				try:
					result = _update_item_prices_with_validity(
						item_change["item_code"],
						item_change["purchase_price"],
						item_change["selling_price"],
						item_change["original_purchase_price"],
						item_change["original_selling_price"],
						item_change["uom"],
					)
					price_update_results.append(result)
				except Exception as e:
					frappe.log_error(frappe.get_traceback(), f"Error updating prices for {item_change['item_code']}")

		# Attach bill if provided
		attachment_result = None
		if attachment_url:
			try:
				attachment_result = _attach_file_to_invoice(doc.name, attachment_url)
			except Exception as e:
				frappe.log_error(frappe.get_traceback(), f"Error attaching file to {doc.name}")

		processing_time = time.time() - start_time
		frappe.logger().info(f"Purchase Invoice {doc.name} processed in {processing_time:.2f} seconds")

		return {
			"success": True,
			"invoice_name": doc.name,
			"invoice_id": doc.name,
			"invoice": {
				"name": doc.name,
				"doctype": doc.doctype,
				"supplier": doc.supplier,
				"supplier_name": doc.supplier_name,
				"posting_date": str(doc.posting_date),
				"base_grand_total": doc.base_grand_total,
				"currency": doc.currency,
				"status": doc.status,
				"update_stock": doc.update_stock,
				"company": doc.company,
			},
			"payment_entry": payment_entry.name if payment_entry else None,
			"price_updates": price_update_results,
			"attachment": attachment_result,
			"processing_time": round(processing_time, 2),
		}

	except Exception as e:
		error_traceback = frappe.get_traceback()
		frappe.log_error(error_traceback, "Create Purchase Invoice Error")
		return {"success": False, "message": str(e), "error": str(e)}


def _create_purchase_payment_entry(purchase_invoice, mode_of_payment, amount):
	"""Create a payment entry for the purchase invoice."""
	try:
		company = purchase_invoice.company
		supplier = purchase_invoice.supplier
		company_doc = frappe.get_doc("Company", company)
		
		# Get mode of payment account
		mode_of_payment_doc = frappe.get_doc("Mode of Payment", mode_of_payment)
		paid_from_account = None

		for account in mode_of_payment_doc.accounts:
			if account.company == company:
				paid_from_account = account.default_account
				break

		if not paid_from_account:
			# Get default cash account from company
			paid_from_account = company_doc.default_cash_account

		if not paid_from_account:
			frappe.log_error(f"No payment account found for {mode_of_payment}")
			return None

		payment_entry = frappe.get_doc({
			"doctype": "Payment Entry",
			"payment_type": "Pay",
			"party_type": "Supplier",
			"party": supplier,
			"company": company,
			"paid_from": paid_from_account,
			"paid_to": purchase_invoice.credit_to,
			"paid_amount": amount,
			"received_amount": amount,
			"reference_no": purchase_invoice.name,
			"reference_date": purchase_invoice.posting_date,
			"mode_of_payment": mode_of_payment,
			"references": [{
				"reference_doctype": "Purchase Invoice",
				"reference_name": purchase_invoice.name,
				"allocated_amount": amount,
			}],
		})

		payment_entry.insert(ignore_permissions=True)
		payment_entry.submit()

		return payment_entry

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"Error creating payment entry: {e!s}")
		return None


def _update_item_prices_with_validity(
	item_code,
	new_purchase_price,
	new_selling_price,
	original_purchase_price=None,
	original_selling_price=None,
	uom=None,
):
	"""
	Update Item Prices with valid_from/valid_upto dates.
	
	Logic:
	1. If Item Price record exists and price changed: set valid_upto on old, create new with valid_from
	2. If Item Price record exists and price NOT changed: do nothing
	3. If NO Item Price record exists: create new record (even if price wasn't changed in cart)
	
	This ensures Item Price records always exist for both buying and selling.
	"""
	from datetime import datetime, timedelta
	
	try:
		results = {"item_code": item_code, "buying_updated": False, "selling_updated": False, "buying_created": False, "selling_created": False}
		now = datetime.now()

		# Get default price lists
		buying_price_list = frappe.db.get_single_value("Buying Settings", "buying_price_list")
		if not buying_price_list:
			buying_price_list = frappe.db.get_value("Price List", {"buying": 1, "enabled": 1}, "name")

		selling_price_list = frappe.db.get_single_value("Selling Settings", "selling_price_list")
		if not selling_price_list:
			selling_price_list = frappe.db.get_value("Price List", {"selling": 1, "enabled": 1}, "name")

		# Get item's stock UOM if not provided
		if not uom:
			uom = frappe.db.get_value("Item", item_code, "stock_uom") or "Nos"

		# Handle buying price
		if new_purchase_price is not None and buying_price_list:
			price_changed = original_purchase_price is None or flt(new_purchase_price) != flt(original_purchase_price)
			result = _update_or_create_price_with_validity(
				item_code=item_code,
				price_list=buying_price_list,
				new_price=new_purchase_price,
				is_buying=True,
				uom=uom,
				now=now,
				price_changed=price_changed,
			)
			if result == "updated":
				results["buying_updated"] = True
			elif result == "created":
				results["buying_created"] = True

		# Handle selling price
		if new_selling_price is not None and selling_price_list:
			price_changed = original_selling_price is None or flt(new_selling_price) != flt(original_selling_price)
			result = _update_or_create_price_with_validity(
				item_code=item_code,
				price_list=selling_price_list,
				new_price=new_selling_price,
				is_buying=False,
				uom=uom,
				now=now,
				price_changed=price_changed,
			)
			if result == "updated":
				results["selling_updated"] = True
			elif result == "created":
				results["selling_created"] = True

		frappe.db.commit()
		return results

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"Error updating prices for {item_code}")
		return {"item_code": item_code, "error": str(e)}


def _update_or_create_price_with_validity(item_code, price_list, new_price, is_buying, uom, now, price_changed):
	"""
	Update or create an Item Price with validity dates.
	
	Returns:
		"updated" - if existing price was ended and new one created
		"created" - if no existing price and new one was created
		None - if no action needed (price exists and unchanged)
	"""
	from datetime import timedelta
	
	# Find existing active price entry (not expired)
	today = now.date()
	
	# Query for existing prices, filtering out expired ones
	existing_prices = frappe.db.sql("""
		SELECT name, price_list_rate, valid_from, valid_upto
		FROM `tabItem Price`
		WHERE item_code = %s
		AND price_list = %s
		AND buying = %s
		AND selling = %s
		AND (uom = %s OR uom IS NULL OR uom = '')
		AND (valid_upto IS NULL OR valid_upto >= %s)
		ORDER BY valid_from DESC, creation DESC
		LIMIT 1
	""", (item_code, price_list, 1 if is_buying else 0, 0 if is_buying else 1, uom, today), as_dict=True)

	if existing_prices:
		existing = existing_prices[0]
		
		# Check if price actually changed
		if flt(existing.price_list_rate) == flt(new_price):
			# Price unchanged and record exists - no action needed
			return None
		
		# Price changed - end the existing price validity and create new
		valid_upto = now - timedelta(seconds=1)
		frappe.db.set_value(
			"Item Price",
			existing.name,
			"valid_upto",
			valid_upto,
			update_modified=False,
		)
		
		# Create new price entry with valid_from = now
		new_price_doc = frappe.get_doc({
			"doctype": "Item Price",
			"item_code": item_code,
			"price_list": price_list,
			"price_list_rate": new_price,
			"buying": 1 if is_buying else 0,
			"selling": 0 if is_buying else 1,
			"uom": uom,
			"valid_from": today,
		})
		new_price_doc.insert(ignore_permissions=True)
		return "updated"
	else:
		# No existing price record - create new one (without valid_from since it's the first)
		new_price_doc = frappe.get_doc({
			"doctype": "Item Price",
			"item_code": item_code,
			"price_list": price_list,
			"price_list_rate": new_price,
			"buying": 1 if is_buying else 0,
			"selling": 0 if is_buying else 1,
			"uom": uom,
			# No valid_from or valid_upto for the first entry
		})
		new_price_doc.insert(ignore_permissions=True)
		return "created"


def _attach_file_to_invoice(invoice_name, file_url):
	"""Attach an existing file to a purchase invoice."""
	try:
		# Find the file document by URL
		file_doc = frappe.db.get_value("File", {"file_url": file_url}, ["name", "file_name"])
		
		if file_doc:
			# Update the file to link to this invoice
			frappe.db.set_value(
				"File",
				file_doc[0],
				{
					"attached_to_doctype": "Purchase Invoice",
					"attached_to_name": invoice_name,
				},
			)
			frappe.db.commit()
			
			return {
				"success": True,
				"file_name": file_doc[1],
				"file_url": file_url,
			}
		else:
			# Create a new file link
			file_doc = frappe.get_doc({
				"doctype": "File",
				"file_url": file_url,
				"attached_to_doctype": "Purchase Invoice",
				"attached_to_name": invoice_name,
				"is_private": 1,
			})
			file_doc.insert(ignore_permissions=True)
			
			return {
				"success": True,
				"file_name": file_doc.name,
				"file_url": file_url,
			}

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"Error attaching file to {invoice_name}")
		return {"success": False, "error": str(e)}
