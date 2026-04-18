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
	"""Check if current user is Administrator (for cashier selection and full visibility)."""
	user_roles = frappe.get_roles(frappe.session.user)
	# Only Administrator role can see all cashiers and select different cashiers
	return "Administrator" in user_roles


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
		
		# Extract total_credit_given from the Credit entry in summary
		credit_entry = payment_summary.get("Credit", {})
		total_credit_given = credit_entry.get("total", 0.0) if credit_entry.get("type") == "credit" else 0.0
		
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
			"total_credit_given": total_credit_given,
		}

	except Exception as e:
		frappe.log_error(
			title="Get Payment Transactions Error",
			message=frappe.get_traceback(),
		)
		return _error_response(str(e))


def _get_user_filter(is_admin, cashier_filter):
	"""
	Determine user filter based on admin status and filter selection.

	By default **all** users (including admins) are scoped to their own
	POS Opening Entry so the Closing Shift shows only the current
	cashier's transactions.  Admins can explicitly select "All Cashiers"
	to see the aggregated day-view.

	Returns:
		- "opening_entry": scope to the current user's opening entry (default)
		- "all":           admin explicitly requested all cashiers
		- <user_id>:       admin filtering a specific cashier
	"""
	if not is_admin:
		return "opening_entry"

	if cashier_filter == "all":
		return "all"
	if cashier_filter and cashier_filter not in ("current_cashier", "my_session"):
		return cashier_filter

	return "opening_entry"


def _fetch_all_payment_transactions(pos_profile, opening_entry_name, opening_date, is_admin, user_filter):
	"""
	Fetch all payment transactions categorized by type (IN/OUT) and source.
	
	Returns:
		{
			"in": {
				"sales": [...],           # Today's sales payments
				"credit_payments": [...], # Payments received for outstanding amounts
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
			"partial_payments": [],
			"credit_payments": [],
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
		inv_disc = abs(float(payment.get("invoice_discount_amount") or 0))
		txn = {
			"id": f"{payment.invoice_name}-{payment.mode_of_payment or 'Unknown'}",
			"type": "out" if payment.is_return else "in",
			"source": "return" if payment.is_return else "sales",
			"payment_mode": payment.mode_of_payment or "Unknown",
			"amount": abs(float(payment.amount or 0)),
			"discount_amount": inv_disc,
			"customer": payment.customer_name or payment.customer or "Unknown",
			"customer_id": payment.customer or "",
			"reference": payment.invoice_name or "",
			"reference_type": "Sales Invoice",
			"timestamp": f"{payment.posting_date} {payment.posting_time}",
			"posting_date": str(payment.posting_date),
			"posting_time": str(payment.posting_time) if payment.posting_time else "00:00:00",
			"cashier": payment.cashier_name or payment.owner or "Unknown",
			"cashier_id": payment.owner or "",
			"is_return": payment.is_return,
			"status": payment.status or "",
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
	
	# Deduplicate: a PE with multiple references produces multiple rows from the JOIN.
	# Keep one transaction per PE, collecting linked invoices.
	# Classification uses custom_pos_payment_type set at creation time:
	# - "Partial Payment" → POS checkout partial payments
	# - "Credit Payment" → outstanding collections via Receive Outstanding
	# Legacy PEs without the field fall back to session-based heuristic.
	seen_pe = {}
	for pe in payment_entries:
		if pe.name in seen_pe:
			existing = seen_pe[pe.name]
			if pe.reference_name and pe.reference_name not in existing["_invoices"]:
				existing["_invoices"].append(pe.reference_name)
			continue
		
		explicit_type = (pe.get("custom_pos_payment_type") or "").strip()
		if explicit_type == "Credit Payment":
			source = "credit_payment"
		elif explicit_type == "Partial Payment":
			source = "partial_payment"
		else:
			source = "partial_payment" if bool(pe.get("custom_pos_opening_entry")) else "credit_payment"

		pe_inv_disc = abs(float(pe.get("invoice_discount_amount") or 0))
		txn = {
			"id": pe.name or "",
			"type": "in" if pe.payment_type == "Receive" else "out",
			"source": source,
			"payment_mode": pe.mode_of_payment or "Unknown",
			"amount": abs(float(pe.paid_amount or 0)),
			"discount_amount": pe_inv_disc,
			"customer": pe.party_name or pe.party or "Unknown",
			"customer_id": pe.party or "",
			"reference": pe.name or "",
			"reference_type": "Payment Entry",
			"linked_invoice": pe.reference_name or "",
			"timestamp": f"{pe.posting_date} {pe.creation_time}",
			"posting_date": str(pe.posting_date),
			"posting_time": pe.creation_time or "00:00:00",
			"cashier": pe.cashier_name or pe.owner or "Unknown",
			"cashier_id": pe.owner or "",
			"is_return": False,
			"status": "Submitted" if pe.docstatus == 1 else "Draft",
			"_invoices": [pe.reference_name] if pe.reference_name else [],
		}
		seen_pe[pe.name] = txn
	
	for txn in seen_pe.values():
		txn.pop("_invoices", None)
		if txn["type"] == "in":
			bucket = "partial_payments" if txn["source"] == "partial_payment" else "credit_payments"
			transactions["in"][bucket].append(txn)
		transactions["transactions"].append(txn)
	
	# 3. Track credits given (unpaid invoices created today) - these are "OUT" as money not received
	credits_given = _fetch_credits_given(
		pos_profile, opening_entry_name, opening_date, is_admin, user_filter
	)
	
	for credit in credits_given:
		credit_disc = abs(float(credit.get("invoice_discount_amount") or 0))
		txn = {
			"id": f"{credit.name}-credit",
			"type": "out",
			"source": "credit_given",
			"payment_mode": "Credit",
			"amount": float(credit.outstanding_amount or 0),
			"discount_amount": credit_disc,
			"customer": credit.customer_name or credit.customer or "Unknown",
			"customer_id": credit.customer or "",
			"reference": credit.name or "",
			"reference_type": "Sales Invoice",
			"timestamp": f"{credit.posting_date} {credit.posting_time}",
			"posting_date": str(credit.posting_date),
			"posting_time": str(credit.posting_time) if credit.posting_time else "00:00:00",
			"cashier": credit.cashier_name or credit.owner or "Unknown",
			"cashier_id": credit.owner or "",
			"is_return": False,
			"status": credit.status or "",
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
	params = []

	if user_filter == "all":
		base_condition = """
			si.pos_profile = %s
			AND si.docstatus = 1
			AND si.posting_date = %s
			AND si.custom_pos_opening_entry IS NOT NULL
			AND si.custom_pos_opening_entry != ''
		"""
		params = [pos_profile, opening_date]
	elif user_filter and user_filter not in ("opening_entry",):
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
			IFNULL(si.discount_amount, 0) as invoice_discount_amount,
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
	
	For current cashier (opening_entry filter), matches entries linked to the opening
	entry OR entries by the same user without a link (created outside the POS app).
	"""
	pe_meta = frappe.get_meta("Payment Entry")
	has_pos_opening_field = pe_meta.has_field("custom_pos_opening_entry")

	params = []
	scope_condition = ""

	if user_filter == "all":
		params.append(opening_date)
		scope_condition = "AND pe.posting_date = %s"
	elif user_filter and user_filter not in ("opening_entry",):
		params.append(opening_date)
		scope_condition = "AND pe.posting_date = %s AND pe.owner = %s"
		params.append(user_filter)
	else:
		if has_pos_opening_field:
			scope_condition = (
				"AND ("
				"  pe.custom_pos_opening_entry = %s"
				"  OR (pe.owner = %s AND pe.posting_date = %s"
				"      AND (pe.custom_pos_opening_entry IS NULL OR pe.custom_pos_opening_entry = ''))"
				")"
			)
			params.append(opening_entry_name)
			params.append(frappe.session.user)
			params.append(opening_date)
		else:
			params.append(opening_date)
			scope_condition = "AND pe.posting_date = %s AND pe.owner = %s"
			params.append(frappe.session.user)
	
	pos_opening_col = "pe.custom_pos_opening_entry," if has_pos_opening_field else "NULL as custom_pos_opening_entry,"
	payment_type_col = "pe.custom_pos_payment_type," if pe_meta.has_field("custom_pos_payment_type") else "NULL as custom_pos_payment_type,"

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
			{pos_opening_col}
			{payment_type_col}
			TIME(pe.creation) as creation_time,
			per.reference_name,
			si.posting_date as reference_posting_date,
			IFNULL(si.discount_amount, 0) as invoice_discount_amount,
			u.full_name as cashier_name
		FROM `tabPayment Entry` pe
		LEFT JOIN `tabPayment Entry Reference` per ON pe.name = per.parent
		LEFT JOIN `tabSales Invoice` si ON per.reference_name = si.name AND per.reference_doctype = 'Sales Invoice'
		LEFT JOIN `tabUser` u ON pe.owner = u.name
		WHERE pe.docstatus = 1
			AND pe.party_type = 'Customer'
			AND pe.payment_type = 'Receive'
			{scope_condition}
		ORDER BY pe.posting_date DESC, pe.creation DESC
	"""
	
	return frappe.db.sql(query, params, as_dict=True)


def _fetch_credits_given(pos_profile, opening_entry_name, opening_date, is_admin, user_filter):
	"""
	Fetch unpaid/partly paid invoices created today (credits extended).
	These represent money NOT received - outflow from cash perspective.
	"""
	params = []

	if user_filter == "all":
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
	elif user_filter and user_filter not in ("opening_entry",):
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
			IFNULL(si.discount_amount, 0) as invoice_discount_amount,
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
	
	Real payment modes (Cash, QR, etc.) get full Opening/In/Out/Net breakdown.
	Credit is tracked separately as a flat total (sum of outstanding amounts).
	"""
	summary = {}
	
	for mode in opening_modes:
		mop = mode.mode_of_payment
		summary[mop] = {
			"name": mop,
			"type": "payment_mode",
			"opening": float(mode.opening_amount or 0.0),
		"in": {
			"sales": 0.0,
			"partial_payments": 0.0,
			"credit_payments": 0.0,
			"total": 0.0
		},
		"out": {
			"returns": 0.0,
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
	
	for txn in transactions_data["in"]["partial_payments"]:
		mop = txn["payment_mode"]
		if mop not in summary:
			summary[mop] = _create_empty_mode_summary(mop)
		summary[mop]["in"]["partial_payments"] += txn["amount"]
		summary[mop]["transactions"] += 1
	
	for txn in transactions_data["in"]["credit_payments"]:
		mop = txn["payment_mode"]
		if mop not in summary:
			summary[mop] = _create_empty_mode_summary(mop)
		summary[mop]["in"]["credit_payments"] += txn["amount"]
		summary[mop]["transactions"] += 1
	
	# Aggregate OUT transactions (returns only for real payment modes)
	for txn in transactions_data["out"]["returns"]:
		mop = txn["payment_mode"]
		if mop not in summary:
			summary[mop] = _create_empty_mode_summary(mop)
		summary[mop]["out"]["returns"] += txn["amount"]
		summary[mop]["transactions"] += 1
	
	# Calculate totals and net for each real payment mode
	for mop, data in summary.items():
		data["in"]["total"] = (
			data["in"]["sales"] +
			data["in"]["partial_payments"] +
			data["in"]["credit_payments"]
		)
		data["out"]["total"] = data["out"]["returns"]
		data["net"] = data["opening"] + data["in"]["total"] - data["out"]["total"]
	
	# Credit is separate: flat total of outstanding amounts from this session
	total_credit_given = sum(txn["amount"] for txn in transactions_data["out"]["credit_given"])
	credit_count = len(transactions_data["out"]["credit_given"])
	summary["Credit"] = {
		"name": "Credit",
		"type": "credit",
		"total": total_credit_given,
		"transactions": credit_count,
	}
	
	return summary


def _create_empty_mode_summary(mode_name):
	"""Create an empty payment mode summary structure."""
	return {
		"name": mode_name,
		"type": "payment_mode",
		"opening": 0.0,
		"in": {
			"sales": 0.0,
			"partial_payments": 0.0,
			"credit_payments": 0.0,
			"total": 0.0
		},
		"out": {
			"returns": 0.0,
			"total": 0.0
		},
		"net": 0.0,
		"transactions": 0
	}


def _build_invoice_summary(pos_profile, opening_entry_name, opening_date, is_admin, user_filter):
	"""Build summary-level invoice statistics."""
	params = []

	if user_filter == "all":
		base_condition = """
			si.pos_profile = %s
			AND si.docstatus = 1
			AND si.posting_date = %s
			AND si.custom_pos_opening_entry IS NOT NULL
			AND si.custom_pos_opening_entry != ''
		"""
		params = [pos_profile, opening_date]
	elif user_filter and user_filter not in ("opening_entry",):
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
			SUM(CASE WHEN si.is_return = 1 THEN ABS(si.grand_total) ELSE 0 END) as total_returns,
			SUM(CASE WHEN si.is_return = 0 THEN IFNULL(si.discount_amount, 0) ELSE 0 END) as total_bill_discount
		FROM `tabSales Invoice` si
		WHERE {base_condition}
	"""
	
	result = frappe.db.sql(query, params, as_dict=True)

	bill_discount_by_cashier = []
	if user_filter == "all":
		cashier_q = f"""
			SELECT
				si.owner as user_id,
				IFNULL(u.full_name, si.owner) as name,
				SUM(IFNULL(si.discount_amount, 0)) as discount_total
			FROM `tabSales Invoice` si
			LEFT JOIN `tabUser` u ON si.owner = u.name
			WHERE {base_condition}
				AND si.is_return = 0
			GROUP BY si.owner, u.full_name
			HAVING SUM(IFNULL(si.discount_amount, 0)) > 0
			ORDER BY discount_total DESC
		"""
		bill_discount_by_cashier = frappe.db.sql(cashier_q, params, as_dict=True) or []
	
	if result and result[0]:
		data = result[0]
		return {
			"total_invoices": int(data.total_invoices or 0),
			"paid": int(data.paid or 0),
			"unpaid": int(data.unpaid or 0),
			"returns": int(data.returns or 0),
			"total_sales": float(data.total_sales or 0),
			"total_returns": float(data.total_returns or 0),
			"net_sales": float((data.total_sales or 0) - (data.total_returns or 0)),
			"total_bill_discount": float(data.total_bill_discount or 0),
			"bill_discount_by_cashier": bill_discount_by_cashier,
		}
	
	return {
		"total_invoices": 0,
		"paid": 0,
		"unpaid": 0,
		"returns": 0,
		"total_sales": 0.0,
		"total_returns": 0.0,
		"net_sales": 0.0,
		"total_bill_discount": 0.0,
		"bill_discount_by_cashier": [],
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


def _parse_report_dates(from_date, to_date):
	"""Normalize YYYY-MM-DD strings; default to today."""
	from frappe.utils import getdate

	today = frappe.utils.today()
	fd = getdate(from_date) if from_date else getdate(today)
	td = getdate(to_date) if to_date else fd
	if td < fd:
		fd, td = td, fd
	return fd, td


def _get_report_user_filter(cashier_filter):
	"""
	For date-range report (admin). cashier_filter from SPA: current_cashier | all | user id.
	Legacy alias my_session is accepted.
	Returns internal filter key: 'all' | <user name>
	"""
	cf = (cashier_filter or "").strip() or "current_cashier"
	if cf == "all":
		return "all"
	if cf in ("current_cashier", "my_session"):
		return frappe.session.user
	return cf


def _pos_payment_method_rows_as_opening_zero(pos_profile):
	rows = frappe.get_all(
		"POS Payment Method",
		filters={"parent": pos_profile},
		fields=["mode_of_payment"],
	)
	# _build_comprehensive_payment_summary uses attribute access (mode.mode_of_payment);
	# frappe.get_all rows are _dict, but plain dict literals are not — use frappe._dict.
	return [
		frappe._dict(mode_of_payment=r.get("mode_of_payment"), opening_amount=0.0)
		for r in rows
		if r.get("mode_of_payment")
	]


def _fetch_sales_invoice_payments_range(pos_profile, date_from, date_to, user_filter):
	params = []
	if user_filter == "all":
		base_condition = """
			si.pos_profile = %s
			AND si.docstatus = 1
			AND si.posting_date BETWEEN %s AND %s
			AND si.custom_pos_opening_entry IS NOT NULL
			AND si.custom_pos_opening_entry != ''
		"""
		params = [pos_profile, date_from, date_to]
	else:
		base_condition = """
			si.pos_profile = %s
			AND si.docstatus = 1
			AND si.posting_date BETWEEN %s AND %s
			AND si.owner = %s
		"""
		params = [pos_profile, date_from, date_to, user_filter]

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
			IFNULL(si.discount_amount, 0) as invoice_discount_amount,
			u.full_name as cashier_name
		FROM `tabSales Invoice` si
		JOIN `tabSales Invoice Payment` sip ON si.name = sip.parent
		LEFT JOIN `tabUser` u ON si.owner = u.name
		WHERE {base_condition}
		ORDER BY si.posting_date DESC, si.posting_time DESC
	"""
	return frappe.db.sql(query, params, as_dict=True)


def _fetch_payment_entries_range(pos_profile, date_from, date_to, user_filter):
	pe_meta = frappe.get_meta("Payment Entry")
	has_pos_opening_field = pe_meta.has_field("custom_pos_opening_entry")
	pos_opening_col = "pe.custom_pos_opening_entry," if has_pos_opening_field else "NULL as custom_pos_opening_entry,"
	payment_type_col = "pe.custom_pos_payment_type," if pe_meta.has_field("custom_pos_payment_type") else "NULL as custom_pos_payment_type,"

	params = []
	if user_filter == "all":
		scope_condition = "AND pe.posting_date BETWEEN %s AND %s"
		params = [date_from, date_to]
	elif user_filter:
		scope_condition = "AND pe.posting_date BETWEEN %s AND %s AND pe.owner = %s"
		params = [date_from, date_to, user_filter]

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
			{pos_opening_col}
			{payment_type_col}
			TIME(pe.creation) as creation_time,
			per.reference_name,
			si.posting_date as reference_posting_date,
			IFNULL(si.discount_amount, 0) as invoice_discount_amount,
			u.full_name as cashier_name
		FROM `tabPayment Entry` pe
		LEFT JOIN `tabPayment Entry Reference` per ON pe.name = per.parent
		LEFT JOIN `tabSales Invoice` si ON per.reference_name = si.name AND per.reference_doctype = 'Sales Invoice'
		LEFT JOIN `tabUser` u ON pe.owner = u.name
		WHERE pe.docstatus = 1
			AND pe.party_type = 'Customer'
			AND pe.payment_type = 'Receive'
			{scope_condition}
		ORDER BY pe.posting_date DESC, pe.creation DESC
	"""
	return frappe.db.sql(query, params, as_dict=True)


def _fetch_credits_given_range(pos_profile, date_from, date_to, user_filter):
	params = []
	if user_filter == "all":
		base_condition = """
			si.pos_profile = %s
			AND si.docstatus = 1
			AND si.posting_date BETWEEN %s AND %s
			AND si.is_return = 0
			AND si.outstanding_amount > 0
			AND si.custom_pos_opening_entry IS NOT NULL
			AND si.custom_pos_opening_entry != ''
		"""
		params = [pos_profile, date_from, date_to]
	else:
		base_condition = """
			si.pos_profile = %s
			AND si.docstatus = 1
			AND si.posting_date BETWEEN %s AND %s
			AND si.is_return = 0
			AND si.outstanding_amount > 0
			AND si.owner = %s
		"""
		params = [pos_profile, date_from, date_to, user_filter]

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
			IFNULL(si.discount_amount, 0) as invoice_discount_amount,
			u.full_name as cashier_name
		FROM `tabSales Invoice` si
		LEFT JOIN `tabUser` u ON si.owner = u.name
		WHERE {base_condition}
		ORDER BY si.posting_date DESC, si.posting_time DESC
	"""
	return frappe.db.sql(query, params, as_dict=True)


def _fetch_all_payment_transactions_range(pos_profile, date_from, date_to, user_filter):
	"""Same structure as _fetch_all_payment_transactions but scoped by posting date range."""
	transactions = {
		"in": {"sales": [], "partial_payments": [], "credit_payments": []},
		"out": {"returns": [], "credit_given": []},
		"transactions": [],
	}

	sales_payments = _fetch_sales_invoice_payments_range(pos_profile, date_from, date_to, user_filter)
	for payment in sales_payments:
		inv_disc = abs(float(payment.get("invoice_discount_amount") or 0))
		txn = {
			"id": f"{payment.invoice_name}-{payment.mode_of_payment or 'Unknown'}",
			"type": "out" if payment.is_return else "in",
			"source": "return" if payment.is_return else "sales",
			"payment_mode": payment.mode_of_payment or "Unknown",
			"amount": abs(float(payment.amount or 0)),
			"discount_amount": inv_disc,
			"customer": payment.customer_name or payment.customer or "Unknown",
			"customer_id": payment.customer or "",
			"reference": payment.invoice_name or "",
			"reference_type": "Sales Invoice",
			"timestamp": f"{payment.posting_date} {payment.posting_time}",
			"posting_date": str(payment.posting_date),
			"posting_time": str(payment.posting_time) if payment.posting_time else "00:00:00",
			"cashier": payment.cashier_name or payment.owner or "Unknown",
			"cashier_id": payment.owner or "",
			"is_return": payment.is_return,
			"status": payment.status or "",
		}
		if payment.is_return:
			transactions["out"]["returns"].append(txn)
		else:
			transactions["in"]["sales"].append(txn)
		transactions["transactions"].append(txn)

	payment_entries = _fetch_payment_entries_range(pos_profile, date_from, date_to, user_filter)
	seen_pe = {}
	for pe in payment_entries:
		if pe.name in seen_pe:
			existing = seen_pe[pe.name]
			if pe.reference_name and pe.reference_name not in existing["_invoices"]:
				existing["_invoices"].append(pe.reference_name)
			continue

		explicit_type = (pe.get("custom_pos_payment_type") or "").strip()
		if explicit_type == "Credit Payment":
			source = "credit_payment"
		elif explicit_type == "Partial Payment":
			source = "partial_payment"
		else:
			source = "partial_payment" if bool(pe.get("custom_pos_opening_entry")) else "credit_payment"

		pe_inv_disc = abs(float(pe.get("invoice_discount_amount") or 0))
		txn = {
			"id": pe.name or "",
			"type": "in" if pe.payment_type == "Receive" else "out",
			"source": source,
			"payment_mode": pe.mode_of_payment or "Unknown",
			"amount": abs(float(pe.paid_amount or 0)),
			"discount_amount": pe_inv_disc,
			"customer": pe.party_name or pe.party or "Unknown",
			"customer_id": pe.party or "",
			"reference": pe.name or "",
			"reference_type": "Payment Entry",
			"linked_invoice": pe.reference_name or "",
			"timestamp": f"{pe.posting_date} {pe.creation_time}",
			"posting_date": str(pe.posting_date),
			"posting_time": pe.creation_time or "00:00:00",
			"cashier": pe.cashier_name or pe.owner or "Unknown",
			"cashier_id": pe.owner or "",
			"is_return": False,
			"status": "Submitted" if pe.docstatus == 1 else "Draft",
			"_invoices": [pe.reference_name] if pe.reference_name else [],
		}
		seen_pe[pe.name] = txn

	for txn in seen_pe.values():
		txn.pop("_invoices", None)
		if txn["type"] == "in":
			bucket = "partial_payments" if txn["source"] == "partial_payment" else "credit_payments"
			transactions["in"][bucket].append(txn)
		transactions["transactions"].append(txn)

	credits_given = _fetch_credits_given_range(pos_profile, date_from, date_to, user_filter)
	for credit in credits_given:
		credit_disc = abs(float(credit.get("invoice_discount_amount") or 0))
		txn = {
			"id": f"{credit.name}-credit",
			"type": "out",
			"source": "credit_given",
			"payment_mode": "Credit",
			"amount": float(credit.outstanding_amount or 0),
			"discount_amount": credit_disc,
			"customer": credit.customer_name or credit.customer or "Unknown",
			"customer_id": credit.customer or "",
			"reference": credit.name or "",
			"reference_type": "Sales Invoice",
			"timestamp": f"{credit.posting_date} {credit.posting_time}",
			"posting_date": str(credit.posting_date),
			"posting_time": str(credit.posting_time) if credit.posting_time else "00:00:00",
			"cashier": credit.cashier_name or credit.owner or "Unknown",
			"cashier_id": credit.owner or "",
			"is_return": False,
			"status": credit.status or "",
		}
		transactions["out"]["credit_given"].append(txn)
		transactions["transactions"].append(txn)

	transactions["transactions"].sort(key=lambda x: x["timestamp"], reverse=True)
	return transactions


def _build_invoice_summary_range(pos_profile, date_from, date_to, user_filter):
	params = []
	if user_filter == "all":
		base_condition = """
			si.pos_profile = %s
			AND si.docstatus = 1
			AND si.posting_date BETWEEN %s AND %s
			AND si.custom_pos_opening_entry IS NOT NULL
			AND si.custom_pos_opening_entry != ''
		"""
		params = [pos_profile, date_from, date_to]
	else:
		base_condition = """
			si.pos_profile = %s
			AND si.docstatus = 1
			AND si.posting_date BETWEEN %s AND %s
			AND si.owner = %s
		"""
		params = [pos_profile, date_from, date_to, user_filter]

	query = f"""
		SELECT
			COUNT(*) as total_invoices,
			SUM(CASE WHEN si.status = 'Paid' THEN 1 ELSE 0 END) as paid,
			SUM(CASE WHEN si.status IN ('Unpaid', 'Overdue', 'Partly Paid') AND si.is_return = 0 THEN 1 ELSE 0 END) as unpaid,
			SUM(CASE WHEN si.is_return = 1 THEN 1 ELSE 0 END) as returns,
			SUM(CASE WHEN si.is_return = 0 THEN si.grand_total ELSE 0 END) as total_sales,
			SUM(CASE WHEN si.is_return = 1 THEN ABS(si.grand_total) ELSE 0 END) as total_returns,
			SUM(CASE WHEN si.is_return = 0 THEN IFNULL(si.discount_amount, 0) ELSE 0 END) as total_bill_discount
		FROM `tabSales Invoice` si
		WHERE {base_condition}
	"""
	result = frappe.db.sql(query, params, as_dict=True)

	bill_discount_by_cashier = []
	if user_filter == "all":
		cashier_q = f"""
			SELECT
				si.owner as user_id,
				IFNULL(u.full_name, si.owner) as name,
				SUM(IFNULL(si.discount_amount, 0)) as discount_total
			FROM `tabSales Invoice` si
			LEFT JOIN `tabUser` u ON si.owner = u.name
			WHERE {base_condition}
				AND si.is_return = 0
			GROUP BY si.owner, u.full_name
			HAVING SUM(IFNULL(si.discount_amount, 0)) > 0
			ORDER BY discount_total DESC
		"""
		bill_discount_by_cashier = frappe.db.sql(cashier_q, params, as_dict=True) or []

	if result and result[0]:
		data = result[0]
		return {
			"total_invoices": int(data.total_invoices or 0),
			"paid": int(data.paid or 0),
			"unpaid": int(data.unpaid or 0),
			"returns": int(data.returns or 0),
			"total_sales": float(data.total_sales or 0),
			"total_returns": float(data.total_returns or 0),
			"net_sales": float((data.total_sales or 0) - (data.total_returns or 0)),
			"total_bill_discount": float(data.total_bill_discount or 0),
			"bill_discount_by_cashier": bill_discount_by_cashier,
		}

	return {
		"total_invoices": 0,
		"paid": 0,
		"unpaid": 0,
		"returns": 0,
		"total_sales": 0.0,
		"total_returns": 0.0,
		"net_sales": 0.0,
		"total_bill_discount": 0.0,
		"bill_discount_by_cashier": [],
	}


def _get_cashiers_list_range(pos_profile, date_from, date_to):
	query = """
		SELECT DISTINCT
			si.owner as user_id,
			u.full_name as name
		FROM `tabSales Invoice` si
		LEFT JOIN `tabUser` u ON si.owner = u.name
		WHERE si.pos_profile = %s
			AND si.docstatus = 1
			AND si.posting_date BETWEEN %s AND %s
			AND si.custom_pos_opening_entry IS NOT NULL
			AND si.custom_pos_opening_entry != ''
		ORDER BY u.full_name
	"""
	cashiers = frappe.db.sql(query, (pos_profile, date_from, date_to), as_dict=True)
	return [{"user_id": "all", "name": "All Cashiers"}] + (cashiers or [])


@frappe.whitelist()
def get_payment_transactions_report(from_date=None, to_date=None, cashier_filter=None):
	"""
	Read-only payment / invoice movement report for a date range (Administrator workflow).

	Does not require an open POS Opening Entry. Opening balances are shown as zero;
	totals reflect activity in the selected range only.
	"""
	try:
		if "Administrator" not in frappe.get_roles(frappe.session.user):
			return _error_response(_("You do not have permission to view this report."))

		date_from, date_to = _parse_report_dates(from_date, to_date)
		user_filter = _get_report_user_filter(cashier_filter)

		pos_doc = get_current_pos_profile()
		pos_profile = pos_doc.name
		mode_rows = _pos_payment_method_rows_as_opening_zero(pos_profile)

		txn_data = _fetch_all_payment_transactions_range(
			pos_profile, date_from, date_to, user_filter
		)
		payment_summary = _build_comprehensive_payment_summary(mode_rows, txn_data)
		invoice_summary = _build_invoice_summary_range(
			pos_profile, date_from, date_to, user_filter
		)
		cashiers = _get_cashiers_list_range(pos_profile, date_from, date_to)

		credit_entry = payment_summary.get("Credit", {})
		total_credit_given = (
			credit_entry.get("total", 0.0) if credit_entry.get("type") == "credit" else 0.0
		)

		return {
			"success": True,
			"pos_profile": pos_profile,
			"from_date": str(date_from),
			"to_date": str(date_to),
			"is_admin": True,
			"payment_summary": payment_summary,
			"transactions": txn_data["transactions"],
			"invoice_summary": invoice_summary,
			"cashiers": cashiers,
			"total_credit_given": total_credit_given,
			"report_mode": True,
		}
	except Exception as e:
		frappe.log_error(
			title="Get Payment Transactions Report Error",
			message=frappe.get_traceback(),
		)
		return _error_response(str(e))
