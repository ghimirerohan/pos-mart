#!/usr/bin/env python3
"""
Diagnose why a batch item fails with "Serial/Batch mandatory" while others don't.
Run from bench console (copy-paste the run() body) or ensure klik_pos.scripts is on path.

Findings for MILK500G-685717:
- Item: has_batch_no=1, has_serial_no=0 (batch-only).
- Stock exists in POS warehouse (Stores - ODD) with serial_and_batch_bundle (no legacy batch_no).
- get_batch_qty(item_code=..., warehouse=...) can return empty/different structure for bundle-only stock.
- Fix: fallback in _get_auto_batch_for_item to resolve batch by iterating Batch and get_batch_qty(batch_no=..., warehouse=...).
"""
import frappe

SLE = "tabStock Ledger Entry"


def run(item_code="MILK500G-685717"):
    if not frappe.db.exists("Item", item_code):
        print(f"Item {item_code} not found.")
        return
    item = frappe.get_doc("Item", item_code)
    print(f"Item {item_code}: has_serial_no={item.has_serial_no}, has_batch_no={item.has_batch_no}")

    sle_with = frappe.db.sql(
        f"SELECT COUNT(*) as c, SUM(actual_qty) as qty FROM `{SLE}` WHERE item_code=%s AND is_cancelled=0 AND serial_and_batch_bundle IS NOT NULL AND serial_and_batch_bundle != ''",
        item_code,
        as_dict=True,
    )[0]
    sle_legacy = frappe.db.sql(
        f"SELECT COUNT(*) as c, SUM(actual_qty) as qty FROM `{SLE}` WHERE item_code=%s AND is_cancelled=0 AND (serial_and_batch_bundle IS NULL OR serial_and_batch_bundle='') AND batch_no IS NOT NULL AND batch_no != ''",
        item_code,
        as_dict=True,
    )[0]
    print(f"SLE with bundle: count={sle_with.c}, qty={sle_with.qty}; legacy batch only: count={sle_legacy.c}, qty={sle_legacy.qty}")

    batches = frappe.get_all("Batch", filters={"item": item_code}, fields=["name", "batch_id", "disabled", "expiry_date"])
    print(f"Batches: {batches}")

    pos_wh = frappe.db.get_value("POS Profile", frappe.get_first("POS Profile"), "warehouse")
    print(f"POS warehouse: {pos_wh}")
    if pos_wh:
        from erpnext.stock.doctype.batch.batch import get_batch_qty
        res = get_batch_qty(item_code=item_code, warehouse=pos_wh)
        print(f"get_batch_qty(item_code, warehouse): type={type(res).__name__}, value={res}")
