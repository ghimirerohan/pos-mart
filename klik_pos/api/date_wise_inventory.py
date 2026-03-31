# Copyright (c) 2025, Klik POS and contributors
# Date Wise Inventory API - reuses ERPNext Stock Ledger report and get_stock_balance.
# Backend operates only in AD; BS date conversion is for defaults/UX only.

import hashlib
import re
import json

import frappe
from frappe import _

DATE_WISE_INVENTORY_ROLE = "Date Wise Inventory Manager"
CACHE_PREFIX = "date_wise_inv:"
CACHE_TTL_SEC = 600
MAX_ROWS = 20000
DEFAULT_PAGE_SIZE = 100


def _normalize_date(s):
	"""Normalize date string to YYYY-MM-DD. Accepts YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY."""
	if not s or not isinstance(s, str):
		return None
	s = s.strip()
	# Already YYYY-MM-DD
	if re.match(r"^\d{4}-\d{2}-\d{2}$", s):
		return s
	# DD/MM/YYYY or D/M/YYYY
	m = re.match(r"^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$", s)
	if m:
		day, month, year = m.group(1), m.group(2), m.group(3)
		return f"{year}-{int(month):02d}-{int(day):02d}"
	# MM/DD/YYYY (US)
	m = re.match(r"^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$", s)
	if m:
		month, day, year = m.group(1), m.group(2), m.group(3)
		return f"{year}-{int(month):02d}-{int(day):02d}"
	return None


def _check_permission():
	roles = frappe.get_roles()
	if "Administrator" in roles or DATE_WISE_INVENTORY_ROLE in roles:
		return
	frappe.throw(_("You do not have permission to view Date Wise Inventory."), frappe.PermissionError)


def _get_default_company():
	from klik_pos.klik_pos.utils import get_current_pos_profile
	pos = get_current_pos_profile()
	if pos and pos.company:
		return pos.company
	companies = frappe.get_all("Company", pluck="name", limit=1)
	return companies[0] if companies else None


def _build_report_filters(filters, company):
	"""Build filters for Stock Ledger execute(). All dates must be AD (YYYY-MM-DD)."""
	from_date = _normalize_date(filters.get("from_date")) or filters.get("from_date")
	to_date = _normalize_date(filters.get("to_date")) or filters.get("to_date")
	if not from_date or not to_date:
		frappe.throw(_("From Date and To Date are required (YYYY-MM-DD)."))
	report_filters = {
		"from_date": from_date,
		"to_date": to_date,
		"company": company or _get_default_company(),
	}
	if not report_filters["company"]:
		frappe.throw(_("Company is required."))
	# Optional filters
	for key in ("item_code", "item_group", "warehouse"):
		if filters.get(key):
			report_filters[key] = filters[key]
	# item_code: report expects list for get_items
	if report_filters.get("item_code") and not isinstance(report_filters["item_code"], (list, tuple)):
		report_filters["item_code"] = [report_filters["item_code"]]
	# Stock Ledger report expects valuation_field_type (used in get_columns)
	report_filters.setdefault("valuation_field_type", "Currency")
	# Return as _dict so report code can use filters.valuation_field_type (attribute access)
	return frappe._dict(report_filters)


def _enrich_with_opening(data, from_date):
	"""Add opening_qty (and opening_stock_value) to each row using get_stock_balance."""
	from erpnext.stock.utils import get_stock_balance

	# Distinct (item_code, warehouse) from real SLE rows (skip opening row)
	distinct_keys = set()
	for row in data:
		item_code = row.get("item_code")
		warehouse = row.get("warehouse")
		if not item_code or not warehouse:
			continue
		# Skip the report's opening row (label 'Opening')
		if str(item_code).strip().strip("'") == "Opening":
			continue
		distinct_keys.add((item_code, warehouse))

	opening_map = {}
	for (item_code, warehouse) in distinct_keys:
		try:
			res = get_stock_balance(
				item_code,
				warehouse,
				posting_date=from_date,
				posting_time="00:00:00",
				with_valuation_rate=True,
			)
			qty = res[0] if isinstance(res, (tuple, list)) else res
			rate = res[1] if isinstance(res, (tuple, list)) and len(res) > 1 else 0.0
			opening_map[(item_code, warehouse)] = (float(qty or 0), float(rate or 0))
		except Exception:
			opening_map[(item_code, warehouse)] = (0.0, 0.0)

	for row in data:
		item_code = row.get("item_code")
		warehouse = row.get("warehouse")
		if not item_code or not warehouse:
			row["opening_qty"] = 0.0
			row["opening_stock_value"] = 0.0
			continue
		if str(item_code).strip().strip("'") == "Opening":
			row["opening_qty"] = 0.0
			row["opening_stock_value"] = 0.0
			continue
		qty, rate = opening_map.get((item_code, warehouse), (0.0, 0.0))
		row["opening_qty"] = qty
		row["opening_stock_value"] = round(qty * rate, 2)
	return data


def _summarize_by_item_warehouse(data, to_date):
	"""
	Aggregate raw stock ledger rows into one row per (item_code, warehouse) for the chosen period.
	Each summary row has: opening_qty, opening_stock_value, sum(in_qty), sum(out_qty),
	closing qty_after_transaction/valuation_rate/stock_value from last entry; date set to to_date.
	"""
	# Skip placeholder rows and collect sortable rows
	rows = []
	for row in data:
		item_code = row.get("item_code")
		warehouse = row.get("warehouse")
		if not item_code or not warehouse:
			continue
		if str(item_code).strip().strip("'") == "Opening":
			continue
		rows.append(row)

	# Sort by item_code, warehouse, date so "last" per group is well-defined
	def _sort_key(r):
		dt = r.get("date")
		if dt is None:
			return (r.get("item_code") or "", r.get("warehouse") or "", "")
		if hasattr(dt, "isoformat"):
			return (r.get("item_code") or "", r.get("warehouse") or "", dt.isoformat())
		return (r.get("item_code") or "", r.get("warehouse") or "", str(dt))

	rows.sort(key=_sort_key)

	# Group by (item_code, warehouse)
	from itertools import groupby
	groups = groupby(rows, key=lambda r: (r.get("item_code"), r.get("warehouse")))

	summarized = []
	for (item_code, warehouse), group_list in groups:
		group = list(group_list)
		first = group[0]
		last = group[-1]
		in_total = sum(frappe.utils.flt(r.get("in_qty"), 0) for r in group)
		out_total = sum(frappe.utils.flt(r.get("out_qty"), 0) for r in group)
		summarized.append({
			"date": to_date,
			"item_code": item_code,
			"item_name": first.get("item_name") or item_code,
			"warehouse": warehouse,
			"opening_qty": frappe.utils.flt(first.get("opening_qty"), 0),
			"opening_stock_value": frappe.utils.flt(first.get("opening_stock_value"), 0),
			"in_qty": in_total,
			"out_qty": out_total,
			"qty_after_transaction": frappe.utils.flt(last.get("qty_after_transaction"), 0),
			"valuation_rate": frappe.utils.flt(last.get("valuation_rate"), 0),
			"stock_value": frappe.utils.flt(last.get("stock_value"), 0),
		})
	return summarized


def _fetch_batch_purchase_rates_in_period(pairs, from_date, to_date, company):
	"""
	(item_code, batch_no) -> unit rate from the earliest submitted Purchase Invoice
	**in [from_date, to_date]** for that company. Used only for Date Wise Inventory
	so batch cost pairs with in-period purchases; if no PI in range, callers should
	use sales-line incoming_rate (COGS tied to those sales, not older buys).
	"""
	if not pairs:
		return {}
	from frappe.utils import flt, getdate

	best = {}  # (ic, bn) -> (posting_date, rate)
	pairs_list = list(pairs)
	chunk_size = 150
	for i in range(0, len(pairs_list), chunk_size):
		chunk = pairs_list[i : i + chunk_size]
		ors = " OR ".join(["(pii.item_code = %s AND pii.batch_no = %s)"] * len(chunk))
		params = [from_date, to_date, company]
		for ic, bn in chunk:
			params.extend([ic, bn])
		rows = frappe.db.sql(
			f"""
			SELECT pii.item_code, pii.batch_no, IFNULL(pii.rate, 0) AS rate, pi.posting_date
			FROM `tabPurchase Invoice Item` pii
			INNER JOIN `tabPurchase Invoice` pi ON pi.name = pii.parent AND pi.docstatus = 1
			WHERE pi.posting_date BETWEEN %s AND %s AND pi.company = %s
				AND ({ors})
			""",
			tuple(params),
			as_dict=True,
		)
		for r in rows:
			key = ((r.get("item_code") or "").strip(), (r.get("batch_no") or "").strip())
			if not key[0] or not key[1]:
				continue
			pd = r.get("posting_date")
			rate = flt(r.get("rate"))
			if key not in best or getdate(pd) < getdate(best[key][0]):
				best[key] = (pd, rate)
	return {k: v[1] for k, v in best.items()}


def _enrich_with_financials(summarized, from_date, to_date, company):
	"""
	Per (item_code, warehouse) in the AD date range:
	- buy_amount: PI lines in range (informational; not used for margin).
	- sale_amount: SI net sales in range.
	- gross_profit / margin_pct: sale_amount minus COGS from **those SI lines only**;
	  unit cost = batch PI rate only if that batch was purchased in the same date range,
	  else active buying price (Item Price / valuation), else incoming_rate on the sales line.
	"""
	if not summarized:
		return summarized

	from frappe.utils import flt

	from klik_pos.api.sales_invoice import (
		_collect_item_batch_pairs_from_lines,
		_fetch_active_buying_prices_for_items,
		_margin_on_sales_pct,
		_resolve_line_unit_cost,
	)

	key_set = set()
	keys = []
	for row in summarized:
		ic = (row.get("item_code") or "").strip()
		wh = (row.get("warehouse") or "").strip()
		if not ic or not wh:
			continue
		k = (ic, wh)
		if k not in key_set:
			key_set.add(k)
			keys.append(k)

	if not keys:
		for row in summarized:
			row["buy_amount"] = 0.0
			row["sale_amount"] = 0.0
			row["gross_profit"] = 0.0
			row["margin_pct"] = 0.0
		return summarized

	buy_rows = frappe.db.sql(
		"""
		SELECT pii.item_code, pii.warehouse,
			SUM(pii.qty * IFNULL(pii.rate, 0)) AS buy_amount
		FROM `tabPurchase Invoice Item` pii
		INNER JOIN `tabPurchase Invoice` pi ON pi.name = pii.parent AND pi.docstatus = 1
		WHERE pi.posting_date BETWEEN %s AND %s AND pi.company = %s
		GROUP BY pii.item_code, pii.warehouse
		""",
		(from_date, to_date, company),
		as_dict=True,
	)
	buy_map = {}
	for r in buy_rows:
		k = ((r.get("item_code") or "").strip(), (r.get("warehouse") or "").strip())
		if k in key_set:
			buy_map[k] = flt(r.get("buy_amount"))

	sale_rows = frappe.db.sql(
		"""
		SELECT sii.item_code, sii.warehouse,
			SUM(IFNULL(sii.base_net_amount, IFNULL(sii.net_amount, 0))) AS sale_amount
		FROM `tabSales Invoice Item` sii
		INNER JOIN `tabSales Invoice` si ON si.name = sii.parent AND si.docstatus = 1
		WHERE IFNULL(si.is_return, 0) = 0
			AND si.posting_date BETWEEN %s AND %s AND si.company = %s
		GROUP BY sii.item_code, sii.warehouse
		""",
		(from_date, to_date, company),
		as_dict=True,
	)
	sale_map = {}
	for r in sale_rows:
		k = ((r.get("item_code") or "").strip(), (r.get("warehouse") or "").strip())
		if k in key_set:
			sale_map[k] = flt(r.get("sale_amount"))

	lines_by_key = {}
	chunk_size = 200
	for i in range(0, len(keys), chunk_size):
		chunk = keys[i : i + chunk_size]
		cond_parts = []
		cparams = []
		for ic, wh in chunk:
			cond_parts.append("(sii.item_code = %s AND sii.warehouse = %s)")
			cparams.extend([ic, wh])
		wheres = " OR ".join(cond_parts)
		q = f"""
		SELECT sii.item_code, sii.warehouse, sii.qty,
			IFNULL(sii.incoming_rate, 0) AS incoming_rate,
			IFNULL(sii.batch_no, '') AS batch_no,
			IFNULL(sii.base_net_amount, 0) AS base_net_amount,
			IFNULL(sii.net_amount, 0) AS net_amount
		FROM `tabSales Invoice Item` sii
		INNER JOIN `tabSales Invoice` si ON si.name = sii.parent AND si.docstatus = 1
		WHERE IFNULL(si.is_return, 0) = 0
			AND si.posting_date BETWEEN %s AND %s AND si.company = %s
			AND ({wheres})
		"""
		params = (from_date, to_date, company) + tuple(cparams)
		for line in frappe.db.sql(q, params, as_dict=True):
			k = ((line.get("item_code") or "").strip(), (line.get("warehouse") or "").strip())
			lines_by_key.setdefault(k, []).append(line)

	all_lines = []
	for lines in lines_by_key.values():
		all_lines.extend(lines)
	batch_map = _fetch_batch_purchase_rates_in_period(
		_collect_item_batch_pairs_from_lines(all_lines),
		from_date,
		to_date,
		company,
	)
	buying_map = _fetch_active_buying_prices_for_items([line.get("item_code") for line in all_lines])

	profit_map = {}
	margin_map = {}
	for k in keys:
		lines = lines_by_key.get(k, [])
		sale_rev = flt(sale_map.get(k, 0.0))
		total_cogs = 0.0
		for line in lines:
			uc = _resolve_line_unit_cost(line, batch_map, buying_map)
			total_cogs += flt(line.get("qty")) * uc
		# Profit uses the same sale_amount aggregate as the grid (SI net in period only)
		profit_map[k] = sale_rev - total_cogs
		margin_map[k] = _margin_on_sales_pct(sale_rev, total_cogs)

	for row in summarized:
		ic = (row.get("item_code") or "").strip()
		wh = (row.get("warehouse") or "").strip()
		if not ic or not wh:
			row["buy_amount"] = 0.0
			row["sale_amount"] = 0.0
			row["gross_profit"] = 0.0
			row["margin_pct"] = 0.0
			continue
		k = (ic, wh)
		row["buy_amount"] = round(flt(buy_map.get(k, 0.0)), 2)
		sale_amt = round(flt(sale_map.get(k, 0.0)), 2)
		row["sale_amount"] = sale_amt
		# Profit and margin only apply when there is sale revenue in the period
		if abs(sale_amt) < 1e-6:
			row["gross_profit"] = 0.0
			row["margin_pct"] = 0.0
		else:
			row["gross_profit"] = round(flt(profit_map.get(k, 0.0)), 2)
			row["margin_pct"] = round(flt(margin_map.get(k, 0.0)), 2)

	return summarized


def _build_response_columns():
	"""Column metadata for list/PDF (no date or warehouse in the grid)."""
	return [
		{"label": _("Item Code"), "fieldname": "item_code", "fieldtype": "Data", "width": 120},
		{"label": _("Item Name"), "fieldname": "item_name", "fieldtype": "Data", "width": 180},
		{"label": _("Opening Qty"), "fieldname": "opening_qty", "fieldtype": "Float", "width": 100},
		{"label": _("Opening Value"), "fieldname": "opening_stock_value", "fieldtype": "Currency", "width": 110},
		{"label": _("In Qty"), "fieldname": "in_qty", "fieldtype": "Float", "width": 90},
		{"label": _("Out Qty"), "fieldname": "out_qty", "fieldtype": "Float", "width": 90},
		{"label": _("Balance Qty"), "fieldname": "qty_after_transaction", "fieldtype": "Float", "width": 100},
		{"label": _("Valuation Rate"), "fieldname": "valuation_rate", "fieldtype": "Currency", "width": 110},
		{"label": _("Stock Value"), "fieldname": "stock_value", "fieldtype": "Currency", "width": 110},
		{"label": _("Buy Amount"), "fieldname": "buy_amount", "fieldtype": "Currency", "width": 110},
		{"label": _("Sale Amount"), "fieldname": "sale_amount", "fieldtype": "Currency", "width": 110},
		{"label": _("Gross Profit"), "fieldname": "gross_profit", "fieldtype": "Currency", "width": 110},
		{"label": _("Margin %"), "fieldname": "margin_pct", "fieldtype": "Float", "width": 90},
	]


def _cache_key(filters, page, page_size, user):
	raw = json.dumps(
		{
			"from_date": filters.get("from_date"),
			"to_date": filters.get("to_date"),
			"company": filters.get("company"),
			"item_code": filters.get("item_code"),
			"item_group": filters.get("item_group"),
			"warehouse": filters.get("warehouse"),
			"page": page,
			"page_size": page_size,
			"user": user,
		},
		sort_keys=True,
		default=str,
	)
	return CACHE_PREFIX + hashlib.sha256(raw.encode()).hexdigest()


@frappe.whitelist()
@frappe.read_only()
def get_data(filters=None, page=1, page_size=None, skip_cache=0):
	"""
	Return paginated Date Wise Inventory data.
	filters: dict with from_date, to_date (AD), company, optional item_code, item_group, warehouse.
	"""
	_check_permission()
	if filters is None:
		filters = {}
	if isinstance(filters, str):
		filters = json.loads(filters) if filters else {}
	page = int(page or 1)
	page_size = int(page_size or DEFAULT_PAGE_SIZE)
	skip_cache = int(skip_cache or 0)

	company = filters.get("company") or _get_default_company()
	if not company:
		frappe.throw(_("Company is required."))
	if not frappe.has_permission("Company", "read", doc=company):
		frappe.throw(_("You do not have permission to access this company."), frappe.PermissionError)

	report_filters = _build_report_filters(filters, company)
	cache_key = _cache_key(report_filters, page, page_size, frappe.session.user)

	if not skip_cache:
		cached = frappe.cache().get_value(cache_key)
		if cached is not None:
			return cached

	try:
		from erpnext.stock.report.stock_ledger.stock_ledger import execute as stock_ledger_execute
	except ImportError:
		frappe.throw(_("Stock Ledger report is not available. Is ERPNext installed?"))

	try:
		_columns_ledger, data = stock_ledger_execute(report_filters)
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Date Wise Inventory get_data")
		frappe.throw(_("Stock report failed: {0}").format(str(e)))
	from_date = report_filters["from_date"]
	try:
		data = _enrich_with_opening(data, from_date)
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Date Wise Inventory opening balance")
		frappe.throw(_("Opening balance failed: {0}").format(str(e)))

	# Summarize: one row per (item_code, warehouse) with summed in/out and closing balance
	to_date = report_filters["to_date"]
	data = _summarize_by_item_warehouse(data, to_date)

	try:
		data = _enrich_with_financials(data, from_date, to_date, company)
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Date Wise Inventory financials")
		frappe.throw(_("Financial enrichment failed: {0}").format(str(e)))

	columns = _build_response_columns()

	total_count = len(data)
	if total_count > MAX_ROWS:
		data = data[:MAX_ROWS]
		total_count = MAX_ROWS

	start = (page - 1) * page_size
	end = start + page_size
	paged_data = data[start:end]

	result = {
		"columns": columns,
		"result": paged_data,
		"total_count": total_count,
		"page": page,
		"page_size": page_size,
	}

	if not skip_cache:
		frappe.cache().set_value(cache_key, result, expires_in_sec=CACHE_TTL_SEC)

	return result


@frappe.whitelist()
def get_bs_defaults():
	"""Return default From/To in BS and AD (first day of current BS month, today)."""
	from datetime import date as ad_date
	today_ad = ad_date.today()
	first_of_month_ad = today_ad.replace(day=1)
	fallback = {
		"from_date_bs": None,
		"to_date_bs": None,
		"from_date_ad": first_of_month_ad.isoformat(),
		"to_date_ad": today_ad.isoformat(),
	}
	try:
		import nepali_datetime
		now_bs = nepali_datetime.date.today()
		first_day_bs = nepali_datetime.date(now_bs.year, now_bs.month, 1)
		from_date_ad = first_day_bs.to_datetime_date().isoformat()
		to_date_ad = now_bs.to_datetime_date().isoformat()
		return {
			"success": True,
			"data": {
				"from_date_bs": {"year": first_day_bs.year, "month": first_day_bs.month, "day": first_day_bs.day},
				"to_date_bs": {"year": now_bs.year, "month": now_bs.month, "day": now_bs.day},
				"from_date_ad": from_date_ad,
				"to_date_ad": to_date_ad,
			},
		}
	except Exception:
		return {"success": True, "data": fallback}


def _parse_bs_date(bs_year, bs_month, bs_day):
	"""Parse and validate BS date. Returns (y, m, d) or raises with clear message."""
	try:
		y, m, d = int(bs_year), int(bs_month), int(bs_day)
	except (TypeError, ValueError):
		frappe.throw(_("BS date must be numbers (year, month, day)."))
	if not (1975 <= y <= 2100):
		frappe.throw(_("BS year must be between 1975 and 2100. You entered: {0}").format(y))
	if not (1 <= m <= 12):
		frappe.throw(_("BS month must be 1–12. You entered: {0}").format(m))
	if not (1 <= d <= 32):
		frappe.throw(_("BS day must be 1–32. You entered: {0}").format(d))
	return y, m, d


def _ad_to_bs_date_only(val):
	"""Convert AD date/datetime to BS date string (YYYY-MM-DD, date only). Returns original if conversion fails."""
	if val is None:
		return ""
	from datetime import date as ad_date, datetime as ad_datetime
	try:
		import nepali_datetime
	except ImportError:
		return _ad_date_only_fallback(val)
	ad_d = None
	if hasattr(val, "date"):
		date_attr = getattr(val, "date", None)
		ad_d = date_attr() if callable(date_attr) else date_attr
	elif hasattr(val, "isoformat"):
		s = val.isoformat() if callable(val.isoformat) else str(val)
		ad_d = _parse_ad_date_from_str(s)
	elif isinstance(val, str):
		ad_d = _parse_ad_date_from_str(val)
	if ad_d is None:
		return str(val)
	try:
		bs = nepali_datetime.date.from_datetime_date(ad_d)
		return f"{bs.year}-{bs.month:02d}-{bs.day:02d}"
	except Exception:
		return _ad_date_only_fallback(val)


def _parse_ad_date_from_str(s):
	"""Parse AD date from ISO or 'YYYY-MM-DD HH:MM:SS' string. Returns datetime.date or None."""
	from datetime import date as ad_date
	if not s or not isinstance(s, str):
		return None
	s = s.strip()
	# ISO: 2026-02-13T02:40:42.502873 or 2026-02-13
	if s.startswith("-") or len(s) < 10:
		return None
	date_part = s[:10]
	if not re.match(r"^\d{4}-\d{2}-\d{2}$", date_part):
		return None
	try:
		y, m, d = int(date_part[:4]), int(date_part[5:7]), int(date_part[8:10])
		return ad_date(y, m, d)
	except (ValueError, TypeError):
		return None


def _ad_date_only_fallback(val):
	"""Return date-only string from val (no BS conversion)."""
	if val is None:
		return ""
	if hasattr(val, "isoformat"):
		s = val.isoformat() if callable(val.isoformat) else str(val)
	else:
		s = str(val)
	date_part = s[:10] if len(s) >= 10 and s[:10].count("-") == 2 else s
	return date_part if re.match(r"^\d{4}-\d{2}-\d{2}$", date_part) else s


@frappe.whitelist()
def bs_to_ad(bs_year, bs_month, bs_day):
	"""Convert BS date to AD date string (YYYY-MM-DD)."""
	try:
		import nepali_datetime
	except ImportError:
		frappe.throw(_("nepali_datetime is not installed. Run: pip install nepali_datetime"))
	y, m, d = _parse_bs_date(bs_year, bs_month, bs_day)
	try:
		bs_date = nepali_datetime.date(y, m, d)
		return bs_date.to_datetime_date().isoformat()
	except (ValueError, OverflowError) as e:
		frappe.throw(_("Invalid BS date: {0}").format(str(e)))


@frappe.whitelist()
def bs_range_to_ad(from_year, from_month, from_day, to_year, to_month, to_day):
	"""Convert BS date range to AD. Returns from_date_ad, to_date_ad."""
	from_ad = bs_to_ad(from_year, from_month, from_day)
	to_ad = bs_to_ad(to_year, to_month, to_day)
	return {
		"from_date_ad": from_ad,
		"to_date_ad": to_ad,
	}


@frappe.whitelist()
def get_filter_options():
	"""Return companies, item_groups, warehouses for Date Wise Inventory filter dropdowns."""
	_check_permission()
	companies = frappe.get_all(
		"Company",
		filters={"enabled": 1},
		fields=["name"],
		order_by="name",
	)
	item_groups = frappe.get_all(
		"Item Group",
		fields=["name"],
		order_by="name",
		limit=500,
	)
	warehouses = frappe.get_all(
		"Warehouse",
		filters={"is_group": 0},
		fields=["name"],
		order_by="name",
		limit=500,
	)
	return {
		"companies": [{"value": c.name, "label": c.name} for c in companies],
		"item_groups": [{"value": g.name, "label": g.name} for g in item_groups],
		"warehouses": [{"value": w.name, "label": w.name} for w in warehouses],
	}


@frappe.whitelist()
def get_items_search(search=None, limit=50):
	"""Return items for Date Wise Inventory item filter (searchable)."""
	_check_permission()
	search = (search or "").strip()
	if not search:
		items = frappe.get_all(
			"Item",
			filters={"is_stock_item": 1},
			fields=["name", "item_name"],
			order_by="name",
			limit=limit,
		)
	else:
		items = frappe.get_all(
			"Item",
			filters={"is_stock_item": 1},
			or_filters=[
				{"name": ["like", f"%{search}%"]},
				{"item_name": ["like", f"%{search}%"]},
			],
			fields=["name", "item_name"],
			order_by="name",
			limit=limit,
		)
	return [{"value": i.name, "label": i.item_name or i.name} for i in items]


@frappe.whitelist()
def export_pdf(filters=None):
	"""Generate PDF of Date Wise Inventory for given filters (AD)."""
	_check_permission()
	if filters is None:
		filters = {}
	if isinstance(filters, str):
		filters = json.loads(filters) if filters else {}

	company = filters.get("company") or _get_default_company()
	if not company:
		frappe.throw(_("Company is required."))
	if not frappe.has_permission("Company", "read", doc=company):
		frappe.throw(_("You do not have permission to access this company."), frappe.PermissionError)

	report_filters = _build_report_filters(filters, company)

	try:
		from erpnext.stock.report.stock_ledger.stock_ledger import execute as stock_ledger_execute
	except ImportError:
		frappe.throw(_("Stock Ledger report is not available."))

	_ledger_cols, data = stock_ledger_execute(report_filters)
	from_date = report_filters["from_date"]
	to_date = report_filters["to_date"]
	data = _enrich_with_opening(data, from_date)

	# Summarize: one row per (item_code, warehouse), same as list view
	data = _summarize_by_item_warehouse(data, to_date)
	data = _enrich_with_financials(data, from_date, to_date, company)

	# Cap for PDF
	if len(data) > 5000:
		data = data[:5000]

	# Header: show BS date range (convert AD from_date / to_date to BS)
	from_bs = _ad_to_bs_date_only(report_filters["from_date"])
	to_bs = _ad_to_bs_date_only(report_filters["to_date"])

	col_order = [
		"item_code", "item_name",
		"opening_qty", "opening_stock_value", "in_qty", "out_qty", "qty_after_transaction",
		"valuation_rate", "stock_value",
		"buy_amount", "sale_amount", "gross_profit", "margin_pct",
	]
	headers = [
		_("Item Code"), _("Item Name"),
		_("Opening Qty"), _("Opening Value"), _("In Qty"), _("Out Qty"), _("Balance Qty"),
		_("Valuation Rate"), _("Stock Value"),
		_("Buy Amount"), _("Sale Amount"), _("Gross Profit"), _("Margin %"),
	]
	rs_fields = frozenset(
		{
			"opening_stock_value",
			"valuation_rate",
			"stock_value",
			"buy_amount",
			"sale_amount",
			"gross_profit",
		}
	)

	def _fmt_pdf_cell(key, val):
		from frappe.utils import flt

		if val is None:
			return ""
		if key == "margin_pct":
			return f"{flt(val):.2f}%"
		if key in rs_fields:
			return f"Rs. {flt(val):,.2f}"
		if hasattr(val, "isoformat"):
			return val.isoformat() if callable(val.isoformat) else str(val)
		return str(val)

	rows = []
	for row in data:
		cells = []
		for key in col_order:
			val = _fmt_pdf_cell(key, row.get(key))
			cells.append(f"<td>{frappe.utils.escape_html(val)}</td>")
		rows.append("<tr>" + "".join(cells) + "</tr>")

	thead = "<thead><tr>" + "".join(f"<th>{frappe.utils.escape_html(h)}</th>" for h in headers) + "</tr></thead>"
	tbody = "<tbody>" + "".join(rows) + "</tbody>"
	html = f"""
	<!DOCTYPE html>
	<html>
	<head><meta charset="utf-8"/><style>
	table {{ border-collapse: collapse; width: 100%; font-size: 10px; }}
	th, td {{ border: 1px solid #ddd; padding: 6px; text-align: left; }}
	th {{ background: #f5f5f5; }}
	</style></head>
	<body>
	<h2>Date Wise Inventory</h2>
	<p>From {frappe.utils.escape_html(from_bs)} to {frappe.utils.escape_html(to_bs)} (BS) | Company: {frappe.utils.escape_html(report_filters['company'])}</p>
	<table>{thead}{tbody}</table>
	</body>
	</html>
	"""

	from frappe.utils.pdf import get_pdf
	pdf_bytes = get_pdf(html, options={"orientation": "Landscape"})
	filename = f"date_wise_inventory_{from_bs}_{to_bs}.pdf"

	frappe.local.response.filename = filename
	frappe.local.response.filecontent = pdf_bytes
	frappe.local.response.type = "pdf"


def invalidate_date_wise_inventory_cache(doc=None, event=None):
	"""Called on Stock Ledger Entry on_submit / on_cancel to clear Date Wise Inventory cache."""
	try:
		frappe.cache().delete_keys(CACHE_PREFIX)
	except Exception:
		pass
