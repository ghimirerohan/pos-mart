#!/usr/bin/env python3
"""
Quick script to apply barcode updates (non-dry-run mode)
Usage: bench --site [site-name] execute klik_pos.apply_barcode_updates.apply_updates
"""

import frappe

def apply_updates():
	"""Apply barcode updates (non-dry-run mode)"""
	from klik_pos.scripts.update_item_code_barcodes import update_item_code_barcodes
	update_item_code_barcodes(dry_run=False)

if __name__ == "__main__":
	apply_updates()
