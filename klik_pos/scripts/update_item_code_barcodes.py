"""
Console script to update items where item_code was used as barcode.
Replaces them with proper unique EAN-13 standard barcodes.

Usage:
    bench --site [site-name] console
    >>> exec(open('apps/klik_pos/klik_pos/scripts/update_item_code_barcodes.py').read())
    
Or run directly:
    bench --site [site-name] execute klik_pos.scripts.update_item_code_barcodes.update_item_code_barcodes
"""

import frappe
from klik_pos.api.item import _generate_unique_barcode


def update_item_code_barcodes(dry_run=True):
	"""
	Update items where barcode equals item_code to use proper EAN-13 barcodes.
	
	Args:
		dry_run: If True, only show what would be changed without making changes
	"""
	frappe.flags.in_console = True
	
	# Find all items where barcode equals item_code
	# Query Item Barcode child table to find barcodes that match their parent item_code
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
			# Generate new unique barcode
			new_barcode = _generate_unique_barcode()
			
			print(f"Item: {item.item_code} ({item.item_name})")
			print(f"  Current barcode: {item.current_barcode}")
			print(f"  New barcode: {new_barcode}")
			
			if not dry_run:
				# Update the barcode in Item Barcode child table
				frappe.db.set_value(
					"Item Barcode",
					item.barcode_name,
					"barcode",
					new_barcode
				)
				
				# Also update barcode_type to EAN for EAN-13
				frappe.db.set_value(
					"Item Barcode",
					item.barcode_name,
					"barcode_type",
					"EAN"
				)
				
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
	
	# Commit if not dry run
	if not dry_run:
		frappe.db.commit()
		print(f"\n✅ Successfully updated {updated_count} items.")
		if error_count > 0:
			print(f"⚠️  {error_count} items had errors (check logs).")
	else:
		print(f"\n⏸️  DRY RUN MODE - No changes made.")
		print(f"   To apply changes, run with dry_run=False:")
		print(f"   >>> update_item_code_barcodes(dry_run=False)")


# Auto-run if executed directly in console
if __name__ == "__main__" or (hasattr(frappe, 'flags') and frappe.flags.in_console):
	# Default to dry run for safety
	update_item_code_barcodes(dry_run=True)
	print("\n" + "="*60)
	print("To apply changes, run:")
	print("  >>> update_item_code_barcodes(dry_run=False)")
	print("="*60)
