"""
STANDALONE CONSOLE SCRIPT - Copy and paste this entire code into Frappe console

This script updates items where item_code was used as barcode,
replacing them with proper unique EAN-13 standard barcodes.

HOW TO USE:
1. Open Frappe console: bench --site [your-site-name] console
2. Copy and paste this ENTIRE code block
3. The script will run in dry-run mode first (shows what would change)
4. To apply changes, run: update_item_code_barcodes(dry_run=False)

Or run directly:
    bench --site [site-name] execute klik_pos.scripts.update_item_code_barcodes.update_item_code_barcodes
"""

import frappe
import time
import random
import secrets


def calculate_ean13_check_digit(barcode_12):
	"""Calculate EAN-13 check digit using the standard algorithm."""
	if len(barcode_12) != 12 or not barcode_12.isdigit():
		raise ValueError("barcode_12 must be exactly 12 digits")
	
	sum_even = sum(int(barcode_12[i]) for i in range(1, 12, 2))
	sum_odd = sum(int(barcode_12[i]) for i in range(0, 12, 2))
	total = sum_odd + (sum_even * 3)
	check_digit = (10 - (total % 10)) % 10
	
	return str(check_digit)


def generate_unique_barcode():
	"""Generate a unique EAN-13 standard barcode."""
	max_attempts = 100
	for attempt in range(max_attempts):
		prefix = "2"  # Internal use prefix
		timestamp_part = str(int(time.time()))[-6:]
		random_part = str(random.randint(10000, 99999))  # 5 digits (total: 1+6+5=12)
		barcode_12 = prefix + timestamp_part + random_part
		check_digit = calculate_ean13_check_digit(barcode_12)
		barcode = barcode_12 + check_digit
		
		if not frappe.db.exists("Item Barcode", {"barcode": barcode}):
			return barcode
	
	# Fallback with more randomness
	prefix = "2"
	random_10 = str(secrets.randbelow(10000000000)).zfill(10)
	barcode_12 = prefix + random_10
	check_digit = calculate_ean13_check_digit(barcode_12)
	return barcode_12 + check_digit


def update_item_code_barcodes(dry_run=True):
	"""
	Update items where barcode equals item_code to use proper EAN-13 barcodes.
	
	Args:
		dry_run: If True, only show what would be changed without making changes
	"""
	# Find all items where barcode equals item_code
	items_to_update = frappe.db.sql("""
		SELECT 
			ib.parent as item_code,
			ib.name as barcode_name,
			ib.barcode as current_barcode,
			i.item_name
		FROM `tabItem Barcode` ib
		INNER JOIN `tabItem` i ON i.name = ib.parent
		WHERE ib.barcode = ib.parent
		AND i.disabled = 0
		ORDER BY i.modified DESC
	""", as_dict=True)
	
	if not items_to_update:
		print("✅ No items found where barcode equals item_code.")
		return
	
	print(f"\n📊 Found {len(items_to_update)} items to update:\n")
	
	updated_count = 0
	error_count = 0
	
	for item in items_to_update:
		try:
			new_barcode = generate_unique_barcode()
			
			print(f"Item: {item.item_code} ({item.item_name})")
			print(f"  Current barcode: {item.current_barcode}")
			print(f"  New barcode: {new_barcode}")
			
			if not dry_run:
				frappe.db.set_value("Item Barcode", item.barcode_name, "barcode", new_barcode)
				frappe.db.set_value("Item Barcode", item.barcode_name, "barcode_type", "EAN")
				print(f"  ✅ Updated successfully")
				updated_count += 1
			else:
				print(f"  ⏸️  Would update (dry run mode)")
			
			print()
			
		except Exception as e:
			error_count += 1
			print(f"  ❌ Error: {str(e)}")
			print()
			frappe.log_error(f"Error updating barcode for {item.item_code}: {str(e)}")
	
	if not dry_run:
		frappe.db.commit()
		print(f"\n✅ Successfully updated {updated_count} items.")
		if error_count > 0:
			print(f"⚠️  {error_count} items had errors (check logs).")
	else:
		print(f"\n⏸️  DRY RUN MODE - No changes made.")
		print(f"   To apply changes, run: update_item_code_barcodes(dry_run=False)")


# Auto-run in dry-run mode for safety
print("="*60)
print("BARCODE UPDATE SCRIPT")
print("="*60)
update_item_code_barcodes(dry_run=True)
print("\n" + "="*60)
print("To apply changes, run:")
print("  >>> update_item_code_barcodes(dry_run=False)")
print("="*60)
