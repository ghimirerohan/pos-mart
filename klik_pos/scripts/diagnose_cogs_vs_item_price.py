"""
Compare dashboard COGS inputs vs Item master / Item Price (buying).

Dashboard uses the same rules as get_dashboard_analytics:
  unit_cogs = PI rate for (item_code, batch_no) if a submitted PI exists for that batch
              else Sales Invoice Item incoming_rate.

Run (examples):

  bench --site development.localhost console
  >>> from klik_pos.scripts.diagnose_cogs_vs_item_price import diagnose
  >>> diagnose("CENTURY-CUMIN-POWDER-2FEEDF")

  bench --site development.localhost execute \\
    klik_pos.scripts.diagnose_cogs_vs_item_price.diagnose \\
    --kwargs "{'item_code': 'CENTURY-CUMIN-POWDER-2FEEDF', 'from_date': '2026-03-28', 'to_date': '2026-03-28'}"
"""

from __future__ import annotations

import frappe
from frappe.utils import flt, getdate, today

from klik_pos.api.sales_invoice import (
	_collect_item_batch_pairs_from_lines,
	_fetch_active_buying_prices_for_items,
	_fetch_batch_purchase_rates,
	_line_net_sales_base,
	_resolve_line_unit_cost,
)


def _default_company(company: str | None) -> str:
	if company:
		return company
	from klik_pos.klik_pos.utils import get_user_default_company

	c = get_user_default_company()
	if c:
		return c
	return frappe.get_all("Company", pluck="name", limit_page_length=1)[0]


def _item_reference_prices(item_code: str) -> dict:
	row = frappe.db.get_value(
		"Item",
		item_code,
		["item_name", "stock_uom", "valuation_rate", "standard_rate"],
		as_dict=True,
	) or {}
	buying = frappe.get_all(
		"Item Price",
		filters={"item_code": item_code, "buying": 1},
		fields=["name", "price_list", "price_list_rate", "uom", "currency", "modified"],
		order_by="modified desc",
	)
	selling = frappe.get_all(
		"Item Price",
		filters={"item_code": item_code, "selling": 1},
		fields=["name", "price_list", "price_list_rate", "uom", "currency", "modified"],
		order_by="modified desc",
		limit_page_length=5,
	)
	return {"item": row, "item_price_buying": buying, "item_price_selling_sample": selling}


def diagnose(
	item_code: str,
	from_date: str | None = None,
	to_date: str | None = None,
	company: str | None = None,
	*,
	silent: bool = False,
) -> dict:
	"""
	For submitted non-return Sales Invoices in the date range, list each SI line for ``item_code``:
	incoming_rate, batch, PI batch rate (earliest PI for that batch), resolved unit COGS, line net revenue, profit.

	Returns a dict ``{"item_code", "company", "from_date", "to_date", "reference", "lines", "summary"}``.
	"""
	item_code = (item_code or "").strip()
	if not item_code:
		frappe.throw("item_code is required")

	tday = getdate(today())
	from_d = getdate(from_date) if from_date else tday
	to_d = getdate(to_date) if to_date else tday
	comp = _default_company(company)

	if not frappe.db.exists("Item", item_code):
		frappe.throw(f"Item not found: {item_code}")

	reference = _item_reference_prices(item_code)

	lines = frappe.db.sql(
		"""
		SELECT sii.parent AS invoice, si.posting_date, si.posting_time,
			sii.item_code, sii.item_name, sii.warehouse, sii.qty,
			IFNULL(sii.incoming_rate, 0) AS incoming_rate,
			IFNULL(sii.batch_no, '') AS batch_no,
			IFNULL(sii.base_net_amount, 0) AS base_net_amount,
			IFNULL(sii.net_amount, 0) AS net_amount
		FROM `tabSales Invoice Item` sii
		INNER JOIN `tabSales Invoice` si ON si.name = sii.parent AND si.docstatus = 1
		WHERE IFNULL(si.is_return, 0) = 0
			AND sii.item_code = %s
			AND si.posting_date BETWEEN %s AND %s
			AND si.company = %s
		ORDER BY si.posting_date, si.posting_time, sii.parent, sii.idx
		""",
		(item_code, from_d, to_d, comp),
		as_dict=True,
	)

	batch_map = _fetch_batch_purchase_rates(_collect_item_batch_pairs_from_lines(lines))
	buying_map = _fetch_active_buying_prices_for_items([line.get("item_code") for line in lines])

	out_lines = []
	total_rev = total_cogs = 0.0
	for line in lines:
		uc = _resolve_line_unit_cost(line, batch_map, buying_map)
		qty = flt(line.get("qty"))
		rev = _line_net_sales_base(line)
		cogs = qty * uc
		bn = (line.get("batch_no") or "").strip()
		ic_line = (line.get("item_code") or "").strip() or item_code
		pi_rate = None
		if bn:
			pi_rate = batch_map.get((ic_line, bn))
		if bn and (ic_line, bn) in batch_map:
			cogs_src = "purchase_invoice_batch"
		elif buying_map.get(ic_line) and flt(buying_map.get(ic_line)) > 0:
			cogs_src = "item_price_or_valuation"
		else:
			cogs_src = "incoming_rate"
		out_lines.append(
			{
				"invoice": line.get("invoice"),
				"posting_date": str(line.get("posting_date")),
				"qty": qty,
				"line_net_revenue": rev,
				"incoming_rate": flt(line.get("incoming_rate")),
				"active_buying_or_valuation": flt(buying_map.get(ic_line)) if buying_map.get(ic_line) else None,
				"batch_no": bn or None,
				"pi_earliest_batch_rate": flt(pi_rate) if pi_rate is not None else None,
				"resolved_unit_cogs": uc,
				"line_cogs": cogs,
				"line_profit": rev - cogs,
				"cogs_source": cogs_src,
			}
		)
		total_rev += rev
		total_cogs += cogs

	result = {
		"item_code": item_code,
		"company": comp,
		"from_date": str(from_d),
		"to_date": str(to_d),
		"reference": reference,
		"lines": out_lines,
		"summary": {
			"line_count": len(out_lines),
			"total_line_net_revenue": total_rev,
			"total_cogs": total_cogs,
			"total_profit": total_rev - total_cogs,
		},
	}

	if not silent:
		_print_report(result)

	return result


def _print_report(result: dict) -> None:
	ir = result["reference"]["item"]
	print("\n=== Item master ===")
	print(f"  item_name: {ir.get('item_name')}")
	print(f"  stock_uom: {ir.get('stock_uom')}")
	print(f"  valuation_rate (Item): {flt(ir.get('valuation_rate'))}")
	print(f"  standard_rate (Item): {flt(ir.get('standard_rate'))}")

	print("\n=== Item Price — buying (all lists, newest modified first) ===")
	for r in result["reference"]["item_price_buying"]:
		print(
			f"  {r.price_list}: {flt(r.price_list_rate)} {r.currency or ''} / {r.uom or ''}  (modified {r.modified})"
		)
	if not result["reference"]["item_price_buying"]:
		print("  (none)")

	print("\n=== Item Price — selling (latest 5) ===")
	for r in result["reference"]["item_price_selling_sample"]:
		print(
			f"  {r.price_list}: {flt(r.price_list_rate)} {r.currency or ''} / {r.uom or ''}  (modified {r.modified})"
		)
	if not result["reference"]["item_price_selling_sample"]:
		print("  (none)")

	print(
		f"\n=== Sales Invoice lines ({result['company']}, {result['from_date']} .. {result['to_date']}) ==="
	)
	if not result["lines"]:
		print("  (no lines in range)")
		return

	for row in result["lines"]:
		print(f"\n  Invoice: {row['invoice']}  ({row['posting_date']})")
		print(f"    qty: {row['qty']}")
		print(f"    line net revenue (excl. tax): {flt(row['line_net_revenue']):.2f}")
		print(f"    incoming_rate (on SI line): {flt(row['incoming_rate']):.4f}")
		ab = row.get("active_buying_or_valuation")
		if ab is not None:
			print(f"    active buying / valuation fallback: {flt(ab):.4f}")
		print(f"    batch_no: {row['batch_no'] or '(empty)'}")
		if row["pi_earliest_batch_rate"] is not None:
			print(f"    PI earliest rate for batch: {flt(row['pi_earliest_batch_rate']):.4f}")
		else:
			print("    PI earliest rate for batch: (none — dashboard uses buying price or incoming_rate)")
		print(f"    resolved unit COGS (dashboard): {flt(row['resolved_unit_cogs']):.4f}  [{row['cogs_source']}]")
		print(f"    line COGS: {flt(row['line_cogs']):.2f}")
		print(f"    line profit: {flt(row['line_profit']):.2f}")

	s = result["summary"]
	print("\n=== Summary (all lines in range) ===")
	print(f"  lines: {s['line_count']}")
	print(f"  total net revenue: {flt(s['total_line_net_revenue']):.2f}")
	print(f"  total COGS: {flt(s['total_cogs']):.2f}")
	print(f"  total profit: {flt(s['total_profit']):.2f}\n")


def run(item_code: str, from_date: str | None = None, to_date: str | None = None, company: str | None = None):
	"""Alias for bench console: ``run(\"ITEM-CODE\")``."""
	return diagnose(item_code, from_date=from_date, to_date=to_date, company=company)
