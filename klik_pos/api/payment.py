import frappe
from frappe import _

from klik_pos.api.sales_invoice import get_current_pos_opening_entry
from klik_pos.klik_pos.utils import get_current_pos_profile


@frappe.whitelist()
def get_payment_modes():
	try:
		# Get pos_profile from query params if provided, otherwise use current profile
		pos_profile = frappe.form_dict.get("pos_profile")

		if pos_profile:
			pos_doc = frappe.get_doc("POS Profile", pos_profile)
		else:
			pos_doc = get_current_pos_profile()
		payment_modes = frappe.get_all(
			"POS Payment Method",
			filters={"parent": pos_doc.name},
			fields=["mode_of_payment", "default", "allow_in_returns"],
		)

		for mode in payment_modes:
			payment_type = frappe.get_value("Mode of Payment", mode["mode_of_payment"], "type")
			mode["type"] = payment_type or "Default"

		return {"success": True, "pos_profile": pos_doc.name, "data": payment_modes}

	except Exception as e:
		frappe.log_error(title="Get Payment Modes Error", message=str(e))
		return {"success": False, "error": str(e)}


@frappe.whitelist()
def get_all_mode_of_payment():
	try:
		mode_of_payments = frappe.get_all(
			"Mode of Payment",
			filters={"enabled": 1},
			fields=["name", "type", "enabled"],
		)
		return mode_of_payments
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Fetch Mode of Payment Error")
		return {"success": False, "message": str(e)}


@frappe.whitelist()
def get_opening_entry_payment_summary():
	"""
	Get payment summary for the current POS opening entry.
	Admins see all transactions for the day, regular users see only their opening entry.
	"""
	try:
		opening_doc = _get_opening_document()
		if not opening_doc:
			return _error_response("No open POS Opening Entry found.")

		opening_info = _extract_opening_info(opening_doc)
		is_admin = _check_admin_privileges()

		sales_data = _fetch_sales_data(
			opening_info["profile"], opening_info["entry_name"], opening_info["date"], is_admin
		)

		payment_summary = _build_payment_summary(opening_info["modes"], sales_data)

		return _success_response(opening_info, payment_summary)

	except Exception as e:
		frappe.log_error(
			title="Get Opening Entry Payment Summary Error",
			message=frappe.get_traceback(),
		)
		return _error_response(str(e))


def _get_opening_document():
	"""Retrieve the current POS opening entry document."""
	current_opening_entry = get_current_pos_opening_entry()
	if not current_opening_entry:
		return None
	return frappe.get_doc("POS Opening Entry", current_opening_entry)


def _extract_opening_info(opening_doc):
	"""Extract and format opening entry information."""
	opening_start = opening_doc.period_start_date

	modes = frappe.get_all(
		"POS Opening Entry Detail",
		filters={"parent": opening_doc.name},
		fields=["mode_of_payment", "opening_amount"],
	)

	return {
		"profile": opening_doc.pos_profile,
		"entry_name": opening_doc.name,
		"date": opening_start.date(),
		"time": opening_start.time().strftime("%H:%M:%S"),
		"modes": modes,
	}


def _check_admin_privileges():
	"""Check if current user has administrative privileges."""
	user_roles = frappe.get_roles(frappe.session.user)
	admin_roles = {"Administrator", "Sales Manager", "System Manager"}
	return bool(admin_roles & set(user_roles))


def _fetch_sales_data(pos_profile, opening_entry_name, opening_date, is_admin):
	"""Fetch aggregated sales payment data based on user privileges."""
	if is_admin:
		frappe.logger().info(
			f"Admin user {frappe.session.user} - aggregating all invoices for date: {opening_date}"
		)
		return _fetch_daily_sales_data(pos_profile, opening_date)

	frappe.logger().info(f"Aggregating payments for POS opening entry: {opening_entry_name}")
	return _fetch_opening_sales_data(opening_entry_name)


def _fetch_daily_sales_data(pos_profile, opening_date):
	"""Fetch all sales data for the day (admin view)."""
	return frappe.db.sql(
		"""
        SELECT
            sip.mode_of_payment,
            SUM(sip.amount) as total_amount,
            COUNT(DISTINCT si.name) as transactions
        FROM `tabSales Invoice` si
        JOIN `tabSales Invoice Payment` sip ON si.name = sip.parent
        WHERE si.pos_profile = %s
          AND si.docstatus = 1
          AND si.posting_date = %s
          AND si.custom_pos_opening_entry IS NOT NULL
          AND si.custom_pos_opening_entry != ''
        GROUP BY sip.mode_of_payment
        """,
		(pos_profile, opening_date),
		as_dict=True,
	)


def _fetch_opening_sales_data(opening_entry_name):
	"""Fetch sales data for specific opening entry (regular user view)."""
	return frappe.db.sql(
		"""
        SELECT
            sip.mode_of_payment,
            SUM(sip.amount) as total_amount,
            COUNT(DISTINCT si.name) as transactions
        FROM `tabSales Invoice` si
        JOIN `tabSales Invoice Payment` sip ON si.name = sip.parent
        WHERE si.custom_pos_opening_entry = %s
          AND si.docstatus = 1
        GROUP BY sip.mode_of_payment
        """,
		(opening_entry_name,),
		as_dict=True,
	)


def _build_payment_summary(opening_modes, sales_data):
	"""Build payment summary by merging opening balances with sales data."""
	sales_map = {row.mode_of_payment: row for row in sales_data}

	summary = []
	for mode in opening_modes:
		mop = mode.mode_of_payment
		sales_info = sales_map.get(mop, {})

		summary.append(
			{
				"name": mop,
				"openingAmount": float(mode.opening_amount or 0.0),
				"amount": float(sales_info.get("total_amount", 0.0)),
				"transactions": int(sales_info.get("transactions", 0)),
			}
		)

	return summary


def _success_response(opening_info, payment_summary):
	"""Build success response."""
	return {
		"success": True,
		"pos_profile": opening_info["profile"],
		"opening_entry": opening_info["entry_name"],
		"date": str(opening_info["date"]),
		"time": opening_info["time"],
		"data": payment_summary,
	}


def _error_response(error_message):
	"""Build error response."""
	return {
		"success": False,
		"error": error_message,
	}


@frappe.whitelist()
def get_payment_transactions(cashier_filter=None):
	"""
	Get comprehensive payment transactions for the closing shift with IN/OUT breakdown.
	
	This API fetches ALL payment movements for the selected timeframe:
	- IN: Sales payments, credit payments (previous credits paid today), partial payments
	- OUT: Return refunds, credits given (unpaid sales)
	
	Args:
		cashier_filter: Optional user ID to filter by cashier. Only works for admin users.
					   If None or 'all', shows all transactions (admin only) or current user's transactions.
	
	Returns:
		{
			"success": True,
			"payment_summary": { mode: { opening, in, out, net, transactions } },
			"transactions": [...],
			"invoice_summary": { total, paid, unpaid, returns, total_sales }
		}
	"""
	try:
		opening_doc = _get_opening_document()
		if not opening_doc:
			return _error_response("No open POS Opening Entry found.")

		opening_info = _extract_opening_info(opening_doc)
		is_admin = _check_admin_privileges()
		
		# Determine which users' transactions to show
		user_filter = _get_user_filter(is_admin, cashier_filter)
		
		# Fetch all transaction data
		transactions_data = _fetch_all_payment_transactions(
			opening_info["profile"],
			opening_info["entry_name"],
			opening_info["date"],
			is_admin,
			user_filter
		)
		
		# Build comprehensive payment summary with IN/OUT breakdown
		payment_summary = _build_comprehensive_payment_summary(
			opening_info["modes"],
			transactions_data
		)
		
		# Build invoice summary
		invoice_summary = _build_invoice_summary(
			opening_info["profile"],
			opening_info["entry_name"],
			opening_info["date"],
			is_admin,
			user_filter
		)
		
		# Get list of cashiers for admin filter dropdown
		cashiers = _get_cashiers_list(opening_info["profile"], opening_info["date"]) if is_admin else []
		
		return {
			"success": True,
			"pos_profile": opening_info["profile"],
			"opening_entry": opening_info["entry_name"],
			"date": str(opening_info["date"]),
			"time": opening_info["time"],
			"is_admin": is_admin,
			"payment_summary": payment_summary,
			"transactions": transactions_data["transactions"],
			"invoice_summary": invoice_summary,
			"cashiers": cashiers,
		}

	except Exception as e:
		frappe.log_error(
			title="Get Payment Transactions Error",
			message=frappe.get_traceback(),
		)
		return _error_response(str(e))


def _get_user_filter(is_admin, cashier_filter):
	"""Determine user filter based on admin status and filter selection."""
	if not is_admin:
		# Non-admin users can only see their own transactions
		return frappe.session.user
	
	# Admin can filter by cashier or see all
	if cashier_filter and cashier_filter != "all":
		return cashier_filter
	
	return None  # None means all users


def _fetch_all_payment_transactions(pos_profile, opening_entry_name, opening_date, is_admin, user_filter):
	"""
	Fetch all payment transactions categorized by type (IN/OUT) and source.
	
	Returns:
		{
			"in": {
				"sales": [...],           # Today's sales payments
				"credit_payments": [...], # Previous credits paid today
				"partial_payments": [...] # Partial payments received
			},
			"out": {
				"returns": [...],         # Return refunds
				"credit_given": [...]     # New credits extended
			},
			"transactions": [...]         # All transactions flat list
		}
	"""
	transactions = {
		"in": {
			"sales": [],
			"credit_payments": [],
			"partial_payments": []
		},
		"out": {
			"returns": [],
			"credit_given": []
		},
		"transactions": []
	}
	
	# 1. Fetch Sales Invoice Payments (POS checkout payments)
	sales_payments = _fetch_sales_invoice_payments(
		pos_profile, opening_entry_name, opening_date, is_admin, user_filter
	)
	
	for payment in sales_payments:
		txn = {
			"id": f"{payment.invoice_name}-{payment.mode_of_payment}",
			"type": "out" if payment.is_return else "in",
			"source": "return" if payment.is_return else "sales",
			"payment_mode": payment.mode_of_payment,
			"amount": abs(float(payment.amount or 0)),
			"customer": payment.customer_name or payment.customer,
			"customer_id": payment.customer,
			"reference": payment.invoice_name,
			"reference_type": "Sales Invoice",
			"timestamp": f"{payment.posting_date} {payment.posting_time}",
			"posting_date": str(payment.posting_date),
			"posting_time": str(payment.posting_time) if payment.posting_time else "00:00:00",
			"cashier": payment.cashier_name or payment.owner,
			"cashier_id": payment.owner,
			"is_return": payment.is_return,
			"status": payment.status,
		}
		
		if payment.is_return:
			transactions["out"]["returns"].append(txn)
		else:
			transactions["in"]["sales"].append(txn)
		
		transactions["transactions"].append(txn)
	
	# 2. Fetch Payment Entries (Credit payments, partial payments for previous invoices)
	payment_entries = _fetch_payment_entries(
		pos_profile, opening_entry_name, opening_date, is_admin, user_filter
	)
	
	for pe in payment_entries:
		# Determine if this is a credit payment or partial payment
		source = "credit_payment"
		if pe.reference_posting_date and str(pe.reference_posting_date) == str(opening_date):
			source = "partial_payment"
		
		txn = {
			"id": pe.name,
			"type": "in" if pe.payment_type == "Receive" else "out",
			"source": source,
			"payment_mode": pe.mode_of_payment,
			"amount": abs(float(pe.paid_amount or 0)),
			"customer": pe.party_name or pe.party,
			"customer_id": pe.party,
			"reference": pe.name,
			"reference_type": "Payment Entry",
			"linked_invoice": pe.reference_name,
			"timestamp": f"{pe.posting_date} {pe.creation_time}",
			"posting_date": str(pe.posting_date),
			"posting_time": pe.creation_time or "00:00:00",
			"cashier": pe.cashier_name or pe.owner,
			"cashier_id": pe.owner,
			"is_return": False,
			"status": "Submitted" if pe.docstatus == 1 else "Draft",
		}
		
		if pe.payment_type == "Receive":
			if source == "partial_payment":
				transactions["in"]["partial_payments"].append(txn)
			else:
				transactions["in"]["credit_payments"].append(txn)
		
		transactions["transactions"].append(txn)
	
	# 3. Track credits given (unpaid invoices created today) - these are "OUT" as money not received
	credits_given = _fetch_credits_given(
		pos_profile, opening_entry_name, opening_date, is_admin, user_filter
	)
	
	for credit in credits_given:
		txn = {
			"id": f"{credit.name}-credit",
			"type": "out",
			"source": "credit_given",
			"payment_mode": "Credit",
			"amount": float(credit.outstanding_amount or 0),
			"customer": credit.customer_name or credit.customer,
			"customer_id": credit.customer,
			"reference": credit.name,
			"reference_type": "Sales Invoice",
			"timestamp": f"{credit.posting_date} {credit.posting_time}",
			"posting_date": str(credit.posting_date),
			"posting_time": str(credit.posting_time) if credit.posting_time else "00:00:00",
			"cashier": credit.cashier_name or credit.owner,
			"cashier_id": credit.owner,
			"is_return": False,
			"status": credit.status,
		}
		
		transactions["out"]["credit_given"].append(txn)
		transactions["transactions"].append(txn)
	
	# Sort transactions by timestamp descending
	transactions["transactions"].sort(
		key=lambda x: x["timestamp"],
		reverse=True
	)
	
	return transactions


def _fetch_sales_invoice_payments(pos_profile, opening_entry_name, opening_date, is_admin, user_filter):
	"""Fetch payments from Sales Invoice Payment child table."""
	user_condition = ""
	params = []
	
	if is_admin and not user_filter:
		# Admin sees all for the day
		base_condition = """
			si.pos_profile = %s
			AND si.docstatus = 1
			AND si.posting_date = %s
			AND si.custom_pos_opening_entry IS NOT NULL
			AND si.custom_pos_opening_entry != ''
		"""
		params = [pos_profile, opening_date]
	elif user_filter:
		# Filter by specific user
		base_condition = """
			si.pos_profile = %s
			AND si.docstatus = 1
			AND si.posting_date = %s
			AND si.owner = %s
		"""
		params = [pos_profile, opening_date, user_filter]
	else:
		# Non-admin sees only their opening entry
		base_condition = """
			si.custom_pos_opening_entry = %s
			AND si.docstatus = 1
		"""
		params = [opening_entry_name]
	
	query = f"""
		SELECT
			si.name as invoice_name,
			si.customer,
			si.customer_name,
			si.posting_date,
			si.posting_time,
			si.owner,
			si.is_return,
			si.status,
			sip.mode_of_payment,
			sip.amount,
			u.full_name as cashier_name
		FROM `tabSales Invoice` si
		JOIN `tabSales Invoice Payment` sip ON si.name = sip.parent
		LEFT JOIN `tabUser` u ON si.owner = u.name
		WHERE {base_condition}
		ORDER BY si.posting_date DESC, si.posting_time DESC
	"""
	
	return frappe.db.sql(query, params, as_dict=True)


def _fetch_payment_entries(pos_profile, opening_entry_name, opening_date, is_admin, user_filter):
	"""
	Fetch Payment Entries for credit payments and partial payments.
	These are payments made against previous invoices.
	"""
	user_condition = ""
	params = [opening_date]
	
	if user_filter:
		user_condition = "AND pe.owner = %s"
		params.append(user_filter)
	
	# Check if custom_pos_opening_entry field exists on Payment Entry
	pe_meta = frappe.get_meta("Payment Entry")
	has_pos_opening_field = pe_meta.has_field("custom_pos_opening_entry")
	
	if has_pos_opening_field and not is_admin:
		pos_condition = "AND pe.custom_pos_opening_entry = %s"
		params.append(opening_entry_name)
	else:
		pos_condition = ""
	
	query = f"""
		SELECT
			pe.name,
			pe.party,
			pe.party_name,
			pe.posting_date,
			pe.paid_amount,
			pe.mode_of_payment,
			pe.payment_type,
			pe.owner,
			pe.docstatus,
			TIME(pe.creation) as creation_time,
			per.reference_name,
			si.posting_date as reference_posting_date,
			u.full_name as cashier_name
		FROM `tabPayment Entry` pe
		LEFT JOIN `tabPayment Entry Reference` per ON pe.name = per.parent
		LEFT JOIN `tabSales Invoice` si ON per.reference_name = si.name AND per.reference_doctype = 'Sales Invoice'
		LEFT JOIN `tabUser` u ON pe.owner = u.name
		WHERE pe.docstatus = 1
			AND pe.posting_date = %s
			AND pe.party_type = 'Customer'
			AND pe.payment_type = 'Receive'
			{user_condition}
			{pos_condition}
		ORDER BY pe.posting_date DESC, pe.creation DESC
	"""
	
	return frappe.db.sql(query, params, as_dict=True)


def _fetch_credits_given(pos_profile, opening_entry_name, opening_date, is_admin, user_filter):
	"""
	Fetch unpaid/partly paid invoices created today (credits extended).
	These represent money NOT received - outflow from cash perspective.
	"""
	user_condition = ""
	params = []
	
	if is_admin and not user_filter:
		base_condition = """
			si.pos_profile = %s
			AND si.docstatus = 1
			AND si.posting_date = %s
			AND si.is_return = 0
			AND si.outstanding_amount > 0
			AND si.custom_pos_opening_entry IS NOT NULL
			AND si.custom_pos_opening_entry != ''
		"""
		params = [pos_profile, opening_date]
	elif user_filter:
		base_condition = """
			si.pos_profile = %s
			AND si.docstatus = 1
			AND si.posting_date = %s
			AND si.is_return = 0
			AND si.outstanding_amount > 0
			AND si.owner = %s
		"""
		params = [pos_profile, opening_date, user_filter]
	else:
		base_condition = """
			si.custom_pos_opening_entry = %s
			AND si.docstatus = 1
			AND si.is_return = 0
			AND si.outstanding_amount > 0
		"""
		params = [opening_entry_name]
	
	query = f"""
		SELECT
			si.name,
			si.customer,
			si.customer_name,
			si.posting_date,
			si.posting_time,
			si.owner,
			si.status,
			si.outstanding_amount,
			si.grand_total,
			u.full_name as cashier_name
		FROM `tabSales Invoice` si
		LEFT JOIN `tabUser` u ON si.owner = u.name
		WHERE {base_condition}
		ORDER BY si.posting_date DESC, si.posting_time DESC
	"""
	
	return frappe.db.sql(query, params, as_dict=True)


def _build_comprehensive_payment_summary(opening_modes, transactions_data):
	"""
	Build comprehensive payment summary with IN/OUT/NET breakdown for each payment mode.
	"""
	# Initialize summary with opening amounts
	summary = {}
	
	for mode in opening_modes:
		mop = mode.mode_of_payment
		summary[mop] = {
			"name": mop,
			"opening": float(mode.opening_amount or 0.0),
			"in": {
				"sales": 0.0,
				"credit_payments": 0.0,
				"partial_payments": 0.0,
				"total": 0.0
			},
			"out": {
				"returns": 0.0,
				"credit_given": 0.0,
				"total": 0.0
			},
			"net": float(mode.opening_amount or 0.0),
			"transactions": 0
		}
	
	# Aggregate IN transactions
	for txn in transactions_data["in"]["sales"]:
		mop = txn["payment_mode"]
		if mop not in summary:
			summary[mop] = _create_empty_mode_summary(mop)
		summary[mop]["in"]["sales"] += txn["amount"]
		summary[mop]["transactions"] += 1
	
	for txn in transactions_data["in"]["credit_payments"]:
		mop = txn["payment_mode"]
		if mop not in summary:
			summary[mop] = _create_empty_mode_summary(mop)
		summary[mop]["in"]["credit_payments"] += txn["amount"]
		summary[mop]["transactions"] += 1
	
	for txn in transactions_data["in"]["partial_payments"]:
		mop = txn["payment_mode"]
		if mop not in summary:
			summary[mop] = _create_empty_mode_summary(mop)
		summary[mop]["in"]["partial_payments"] += txn["amount"]
		summary[mop]["transactions"] += 1
	
	# Aggregate OUT transactions
	for txn in transactions_data["out"]["returns"]:
		mop = txn["payment_mode"]
		if mop not in summary:
			summary[mop] = _create_empty_mode_summary(mop)
		summary[mop]["out"]["returns"] += txn["amount"]
		summary[mop]["transactions"] += 1
	
	# Credits given don't affect cash payment modes, track separately
	total_credit_given = sum(txn["amount"] for txn in transactions_data["out"]["credit_given"])
	if "Credit" not in summary:
		summary["Credit"] = _create_empty_mode_summary("Credit")
	summary["Credit"]["out"]["credit_given"] = total_credit_given
	summary["Credit"]["transactions"] += len(transactions_data["out"]["credit_given"])
	
	# Calculate totals and net for each mode
	for mop, data in summary.items():
		data["in"]["total"] = (
			data["in"]["sales"] +
			data["in"]["credit_payments"] +
			data["in"]["partial_payments"]
		)
		data["out"]["total"] = (
			data["out"]["returns"] +
			data["out"]["credit_given"]
		)
		data["net"] = data["opening"] + data["in"]["total"] - data["out"]["total"]
	
	return summary


def _create_empty_mode_summary(mode_name):
	"""Create an empty payment mode summary structure."""
	return {
		"name": mode_name,
		"opening": 0.0,
		"in": {
			"sales": 0.0,
			"credit_payments": 0.0,
			"partial_payments": 0.0,
			"total": 0.0
		},
		"out": {
			"returns": 0.0,
			"credit_given": 0.0,
			"total": 0.0
		},
		"net": 0.0,
		"transactions": 0
	}


def _build_invoice_summary(pos_profile, opening_entry_name, opening_date, is_admin, user_filter):
	"""Build summary-level invoice statistics."""
	params = []
	
	if is_admin and not user_filter:
		base_condition = """
			si.pos_profile = %s
			AND si.docstatus = 1
			AND si.posting_date = %s
			AND si.custom_pos_opening_entry IS NOT NULL
			AND si.custom_pos_opening_entry != ''
		"""
		params = [pos_profile, opening_date]
	elif user_filter:
		base_condition = """
			si.pos_profile = %s
			AND si.docstatus = 1
			AND si.posting_date = %s
			AND si.owner = %s
		"""
		params = [pos_profile, opening_date, user_filter]
	else:
		base_condition = """
			si.custom_pos_opening_entry = %s
			AND si.docstatus = 1
		"""
		params = [opening_entry_name]
	
	query = f"""
		SELECT
			COUNT(*) as total_invoices,
			SUM(CASE WHEN si.status = 'Paid' THEN 1 ELSE 0 END) as paid,
			SUM(CASE WHEN si.status IN ('Unpaid', 'Overdue', 'Partly Paid') AND si.is_return = 0 THEN 1 ELSE 0 END) as unpaid,
			SUM(CASE WHEN si.is_return = 1 THEN 1 ELSE 0 END) as returns,
			SUM(CASE WHEN si.is_return = 0 THEN si.grand_total ELSE 0 END) as total_sales,
			SUM(CASE WHEN si.is_return = 1 THEN ABS(si.grand_total) ELSE 0 END) as total_returns
		FROM `tabSales Invoice` si
		WHERE {base_condition}
	"""
	
	result = frappe.db.sql(query, params, as_dict=True)
	
	if result and result[0]:
		data = result[0]
		return {
			"total_invoices": int(data.total_invoices or 0),
			"paid": int(data.paid or 0),
			"unpaid": int(data.unpaid or 0),
			"returns": int(data.returns or 0),
			"total_sales": float(data.total_sales or 0),
			"total_returns": float(data.total_returns or 0),
			"net_sales": float((data.total_sales or 0) - (data.total_returns or 0))
		}
	
	return {
		"total_invoices": 0,
		"paid": 0,
		"unpaid": 0,
		"returns": 0,
		"total_sales": 0.0,
		"total_returns": 0.0,
		"net_sales": 0.0
	}


def _get_cashiers_list(pos_profile, opening_date):
	"""Get list of cashiers who have transactions for the day (for admin filter)."""
	query = """
		SELECT DISTINCT
			si.owner as user_id,
			u.full_name as name
		FROM `tabSales Invoice` si
		LEFT JOIN `tabUser` u ON si.owner = u.name
		WHERE si.pos_profile = %s
			AND si.docstatus = 1
			AND si.posting_date = %s
			AND si.custom_pos_opening_entry IS NOT NULL
			AND si.custom_pos_opening_entry != ''
		ORDER BY u.full_name
	"""
	
	cashiers = frappe.db.sql(query, (pos_profile, opening_date), as_dict=True)
	
	# Add "All" option at the beginning
	return [{"user_id": "all", "name": "All Cashiers"}] + cashiers
