import frappe
from erpnext.accounts.doctype.pricing_rule.pricing_rule import apply_pricing_rule
from erpnext.stock.utils import get_stock_balance
from frappe import _
from frappe.utils import flt, get_datetime, getdate, today

from klik_pos.api.sales_invoice import get_current_pos_opening_entry
from klik_pos.klik_pos.utils import get_current_pos_profile


def _get_batch_qty_combined(batch_no, warehouse):
	"""Get batch qty accounting for both old-style (SLE.batch_no) and
	new-style (Serial and Batch Bundle) stock tracking."""
	old_qty = frappe.db.sql(
		"""SELECT COALESCE(SUM(actual_qty), 0)
		   FROM `tabStock Ledger Entry`
		   WHERE batch_no = %s AND warehouse = %s AND is_cancelled = 0""",
		(batch_no, warehouse),
	)[0][0] or 0

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


def _calculate_ean13_check_digit(barcode_12: str) -> str:
	"""
	Calculate EAN-13 check digit using the standard algorithm.
	
	Args:
		barcode_12: 12-digit barcode without check digit
		
	Returns:
		Check digit (single digit as string)
	"""
	if len(barcode_12) != 12 or not barcode_12.isdigit():
		raise ValueError("barcode_12 must be exactly 12 digits")
	
	# EAN-13 check digit calculation
	sum_even = sum(int(barcode_12[i]) for i in range(1, 12, 2))  # Even positions (1-indexed)
	sum_odd = sum(int(barcode_12[i]) for i in range(0, 12, 2))    # Odd positions (1-indexed)
	total = sum_odd + (sum_even * 3)
	check_digit = (10 - (total % 10)) % 10
	
	return str(check_digit)


def _generate_unique_barcode() -> str:
	"""
	Generate a unique EAN-13 standard barcode.
	
	Uses a combination of timestamp and random number to ensure uniqueness.
	Format: 2 (internal use prefix) + 6 digits (timestamp) + 5 digits (random) + 1 check digit = 13 digits
	
	Returns:
		13-digit EAN-13 barcode string
	"""
	import time
	import random
	
	max_attempts = 100
	for attempt in range(max_attempts):
		# Use prefix 2 for internal use (not assigned to any country)
		prefix = "2"
		
		# Get timestamp (last 6 digits of Unix timestamp)
		timestamp_part = str(int(time.time()))[-6:]
		
		# Add random 5 digits for uniqueness (total: 1 prefix + 6 timestamp + 5 random = 12 digits)
		random_part = str(random.randint(10000, 99999))
		
		# Combine to make 12 digits (prefix + timestamp + random)
		barcode_12 = prefix + timestamp_part + random_part
		
		# Calculate check digit
		check_digit = _calculate_ean13_check_digit(barcode_12)
		
		# Full 13-digit barcode
		barcode = barcode_12 + check_digit
		
		# Check if barcode already exists
		if not frappe.db.exists("Item Barcode", {"barcode": barcode}):
			return barcode
	
	# If we couldn't generate a unique barcode after max attempts, use a more random approach
	import secrets
	prefix = "2"
	random_10 = str(secrets.randbelow(10000000000)).zfill(10)
	barcode_12 = prefix + random_10
	check_digit = _calculate_ean13_check_digit(barcode_12)
	return barcode_12 + check_digit


def _detect_barcode_type(barcode: str) -> str | None:
	"""
	Auto-detect barcode type based on format.
	Returns the barcode type if it matches a known format, otherwise None (allowing any format).
	
	Supported types:
	- EAN-13: 13 digits
	- EAN-8: 8 digits  
	- UPC-A: 12 digits
	- None: Any other format (no validation)
	"""
	if not barcode:
		return None
	
	# Remove any whitespace
	barcode = barcode.strip()
	
	# Check if barcode is all digits
	if not barcode.isdigit():
		# Not a standard EAN/UPC - allow any format
		return None
	
	length = len(barcode)
	
	# EAN-13 (most common international barcode)
	if length == 13:
		return "EAN"
	
	# EAN-8 (short form)
	if length == 8:
		return "EAN"
	
	# UPC-A (common in North America)
	if length == 12:
		return "UPC-A"
	
	# Any other format - don't set type to allow flexibility
	# This handles Code128, Code39, custom barcodes, item codes as barcodes, etc.
	return None


def get_price_list_with_customer_priority(customer=None):
	"""
	Get price list with customer-first priority:
	1. Customer's default price list (if customer provided and has one)
	2. POS Profile's selling price list
	3. None (fallback to latest price)
	"""
	try:
		# First priority: Check customer's default price list
		if customer:
			customer_price_list = frappe.db.get_value("Customer", customer, "default_price_list")
			if customer_price_list:
				return customer_price_list

		# Second priority: POS Profile's selling price list
		pos_doc = get_current_pos_profile()
		pos_price_list = getattr(pos_doc, "selling_price_list", None)
		if pos_price_list:
			return pos_price_list

		# Fallback: No specific price list
		return None

	except Exception:
		frappe.log_error(frappe.get_traceback(), "Error getting price list with customer priority")
		return None


def fetch_item_balance(item_code: str, warehouse: str) -> float:
	"""Get stock balance of an item from a warehouse."""
	try:
		return get_stock_balance(item_code, warehouse) or 0
	except Exception:
		frappe.log_error(frappe.get_traceback(), f"Error fetching balance for {item_code}")
		return 0


def _get_uom_conversion_factor(item_code: str, uom: str) -> float | None:
	"""Get conversion factor for a specific UOM from Item UOM table."""
	try:
		conversion_factor = frappe.db.get_value(
			"UOM",
			{"parent": item_code, "uom": uom},
			"conversion_factor",
		)
		return float(conversion_factor) if conversion_factor else None
	except Exception:
		return None


def _calculate_price_from_default_uom(
	item_code: str, requested_uom: str, price_list: str | None, customer: str | None
) -> dict | None:
	"""
	Calculate price for requested UOM from default UOM (stock_uom) using conversion factor.
	Returns None if calculation is not possible.
	This function directly queries for default UOM price to avoid recursion.
	"""
	try:
		item_doc = frappe.get_doc("Item", item_code)
		default_uom = item_doc.stock_uom

		# If requested UOM is already the default UOM, no conversion needed
		if requested_uom == default_uom:
			return None

		# Get conversion factor for requested UOM
		conversion_factor = _get_uom_conversion_factor(item_code, requested_uom)
		if not conversion_factor:
			return None

		# Determine the price list to use
		if not price_list:
			price_list = get_price_list_with_customer_priority(customer)

		# Directly query for default UOM price to avoid recursion
		default_uom_filters = {
			"item_code": item_code,
			"uom": default_uom,
			"selling": 1,
		}

		if price_list and price_list.strip():
			default_uom_filters["price_list"] = price_list

		default_price_doc = frappe.get_value(
			"Item Price",
			default_uom_filters,
			["price_list_rate", "currency"],
			as_dict=True,
		)

		# If no price found with price_list, try without price_list filter
		if not default_price_doc and price_list:
			default_uom_filters.pop("price_list", None)
			default_price_doc = frappe.get_value(
				"Item Price",
				default_uom_filters,
				["price_list_rate", "currency"],
				as_dict=True,
				order_by="modified desc",
			)

		if default_price_doc and default_price_doc.price_list_rate:
			# Calculate price: default_uom_price * conversion_factor
			calculated_price = float(default_price_doc.price_list_rate) * conversion_factor
			symbol = (
				frappe.db.get_value("Currency", default_price_doc.currency, "symbol")
				or default_price_doc.currency
			)
			return {
				"price": calculated_price,
				"currency": default_price_doc.currency,
				"currency_symbol": symbol,
			}

		return None
	except Exception:
		frappe.log_error(
			frappe.get_traceback(),
			f"Error calculating price from default UOM for {item_code}, UOM: {requested_uom}",
		)
		return None


def fetch_item_price(
	item_code: str, price_list: str | None = None, customer: str | None = None, uom: str | None = None
) -> dict:
	"""
	Get item price from Item Price doctype with customer-first priority.
	If price_list is provided, use it. Otherwise, determine price list using customer-first priority.
	If uom is provided, filter by that UOM. Otherwise, get latest price regardless of UOM.
	"""
	try:
		# Determine the price list to use
		if not price_list:
			price_list = get_price_list_with_customer_priority(customer)

		# Build base filters
		price_filters = {
			"item_code": item_code,
			"selling": 1,
		}

		# Add UOM filter if provided
		if uom:
			price_filters["uom"] = uom

		# If price_list is null or empty, get latest price without price_list filter
		if not price_list or price_list.strip() == "":
			price_doc = frappe.get_value(
				"Item Price",
				price_filters,
				["price_list_rate", "currency"],
				as_dict=True,
				order_by="modified desc",
			)

			if price_doc:
				symbol = frappe.db.get_value("Currency", price_doc.currency, "symbol") or price_doc.currency
				return {
					"price": price_doc.price_list_rate,
					"currency": price_doc.currency,
					"currency_symbol": symbol,
				}
			else:
				# If UOM was specified but no price found, calculate from default UOM
				if uom:
					calculated_price_info = _calculate_price_from_default_uom(
						item_code, uom, price_list, customer
					)
					if calculated_price_info:
						return calculated_price_info

				# Fallback to item's default price if no price found
				item_doc = frappe.get_doc("Item", item_code)
				default_currency = (
					frappe.get_value(
						"Company",
						frappe.defaults.get_user_default("Company"),
						"default_currency",
					)
					or "SAR"
				)
				default_symbol = (
					frappe.db.get_value("Currency", default_currency, "symbol") or default_currency
				)

				# If UOM is specified and different from stock_uom, apply conversion factor
				valuation_price = item_doc.valuation_rate or 0
				if uom and uom != item_doc.stock_uom:
					conversion_factor = _get_uom_conversion_factor(item_code, uom)
					if conversion_factor:
						valuation_price = float(valuation_price) * conversion_factor

				return {
					"price": valuation_price,
					"currency": default_currency,
					"currency_symbol": default_symbol,
				}

		# Normal price list lookup
		price_filters["price_list"] = price_list
		price_doc = frappe.get_value(
			"Item Price",
			price_filters,
			["price_list_rate", "currency"],
			as_dict=True,
		)

		if price_doc:
			symbol = frappe.db.get_value("Currency", price_doc.currency, "symbol") or price_doc.currency
			return {
				"price": price_doc.price_list_rate,
				"currency": price_doc.currency,
				"currency_symbol": symbol,
			}
		else:
			# If UOM was specified but no price found, calculate from default UOM
			if uom:
				calculated_price_info = _calculate_price_from_default_uom(
					item_code, uom, price_list, customer
				)
				if calculated_price_info:
					return calculated_price_info

			# Fallback to item's default price if no price list entry found
			item_doc = frappe.get_doc("Item", item_code)
			default_currency = (
				frappe.get_value(
					"Company",
					frappe.defaults.get_user_default("Company"),
					"default_currency",
				)
				or "SAR"
			)
			default_symbol = frappe.db.get_value("Currency", default_currency, "symbol") or default_currency

			# If UOM is specified and different from stock_uom, apply conversion factor
			valuation_price = item_doc.valuation_rate or 0
			if uom and uom != item_doc.stock_uom:
				conversion_factor = _get_uom_conversion_factor(item_code, uom)
				if conversion_factor:
					valuation_price = float(valuation_price) * conversion_factor

			return {
				"price": valuation_price,
				"currency": default_currency,
				"currency_symbol": default_symbol,
			}

	except Exception:
		frappe.log_error(frappe.get_traceback(), f"Error fetching price for {item_code}")
		return {"price": 0, "currency": "SAR", "currency_symbol": "SAR"}


@frappe.whitelist(allow_guest=True)
def get_item_price_for_customer(item_code, customer=None, uom=None):
	"""
	Get item price for a specific customer using customer-first price list priority.
	This is used when adding items to cart or when customer changes.
	If uom is provided, filter by that UOM to ensure price matches the item's UOM.
	"""
	try:
		if not item_code:
			return {"success": False, "price": 0, "currency": "SAR", "currency_symbol": "SAR"}

		# Get price using customer-first priority, with UOM filter if provided
		price_info = fetch_item_price(item_code, customer=customer, uom=uom)

		return {
			"success": True,
			"price": price_info["price"],
			"currency": price_info["currency"],
			"currency_symbol": price_info["currency_symbol"],
		}

	except Exception as e:
		frappe.log_error(
			frappe.get_traceback(),
			f"Error getting item price for customer: {item_code}",
		)
		return {
			"success": False,
			"price": 0,
			"currency": "SAR",
			"currency_symbol": "SAR",
			"error": str(e),
		}


@frappe.whitelist(allow_guest=True)
def get_item_by_barcode(barcode: str):
	"""Get item details by barcode."""
	try:
		pos_doc = get_current_pos_profile()
		warehouse = pos_doc.warehouse
		price_list = pos_doc.selling_price_list

		item_code = frappe.db.sql(
			"""
            SELECT parent
            FROM `tabItem Barcode`
            WHERE barcode = %s
        """,
			barcode,
			as_dict=True,
		)

		if not item_code:
			item_code = frappe.db.sql(
				"""
                SELECT name
                FROM `tabItem`
                WHERE name = %s AND disabled = 0
            """,
				barcode,
				as_dict=True,
			)

		if not item_code:
			frappe.throw(_("Item not found for barcode: {0}").format(barcode))

		item_name = item_code[0].parent or item_code[0].name

		item_doc = frappe.get_doc("Item", item_name)

		balance = fetch_item_balance(item_name, warehouse)
		price_info = fetch_item_price(item_name, price_list)

		return {
			"item_code": item_name,
			"item_name": item_doc.item_name or item_name,
			"description": item_doc.description or "",
			"item_group": item_doc.item_group or "General",
			"price": price_info["price"],
			"currency": price_info["currency"],
			"currency_symbol": price_info["currency_symbol"],
			"available": balance,
			"image": item_doc.image,
		}

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"Error fetching item by barcode: {barcode}")
		frappe.throw(_("Error fetching item by barcode: {0}").format(str(e)))


@frappe.whitelist(allow_guest=True)
def get_item_by_identifier(code: str):
	"""Resolve an item by barcode, batch number or serial number.
	Returns same structure as get_item_by_barcode."""
	try:
		if not code:
			frappe.throw(_("Identifier required"))

		pos_doc = get_current_pos_profile()
		warehouse = pos_doc.warehouse
		price_list = pos_doc.selling_price_list

		matched_type = None
		matched_value = None

		# 1) Try Item Barcode
		item_row = frappe.db.sql(
			"""
            SELECT parent as item_code
            FROM `tabItem Barcode`
            WHERE barcode = %s
            """,
			code,
			as_dict=True,
		)
		if item_row:
			matched_type = "barcode"
			matched_value = code

		# 2) Try Batch by batch_id or name
		if not item_row:
			item_row = frappe.db.sql(
				"""
                SELECT b.item as item_code
                FROM `tabBatch` b
                WHERE b.batch_id = %s OR b.name = %s
                """,
				(code, code),
				as_dict=True,
			)
			if item_row:
				matched_type = "batch"
				matched_value = code

		# 3) Try Serial No
		if not item_row:
			# In ERPNext, the Serial No doctype has field name=serial_no; item_code links to Item
			item_row = frappe.db.sql(
				"""
                SELECT s.item_code as item_code
                FROM `tabSerial No` s
                WHERE s.name = %s OR s.serial_no = %s
                """,
				(code, code),
				as_dict=True,
			)
			if item_row:
				matched_type = "serial"
				matched_value = code

		if not item_row:
			frappe.throw(_("Item not found for identifier: {0}").format(code))

		item_code = item_row[0].get("item_code")
		if not item_code:
			frappe.throw(_("Invalid identifier mapping for: {0}").format(code))

		item_doc = frappe.get_doc("Item", item_code)
		balance = fetch_item_balance(item_code, warehouse)
		price_info = fetch_item_price(item_code, price_list)

		return {
			"item_code": item_code,
			"item_name": item_doc.item_name or item_code,
			"description": item_doc.description or "",
			"item_group": item_doc.item_group or "General",
			"price": price_info["price"],
			"currency": price_info["currency"],
			"currency_symbol": price_info["currency_symbol"],
			"available": balance,
			"image": item_doc.image,
			"matched_type": matched_type,
			"matched_value": matched_value,
		}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"Error fetching item by identifier: {code}")
		frappe.throw(_("Error fetching item by identifier: {0}").format(str(e)))


def _get_pos_context():
	"""Get POS profile and warehouse context with safe fallbacks."""
	try:
		pos_doc = get_current_pos_profile()
	except Exception:
		frappe.log_error(frappe.get_traceback(), "get_current_pos_profile failed")
		pos_doc = frappe._dict({})

	warehouse = getattr(pos_doc, "warehouse", None)
	if not warehouse:
		try:
			default_company = frappe.defaults.get_user_default("Company") or frappe.db.get_single_value(
				"Global Defaults", "default_company"
			)
			warehouse = frappe.db.get_value("Company", default_company, "default_warehouse")
		except Exception:
			warehouse = None
	if not warehouse:
		try:
			any_wh = frappe.get_all("Warehouse", filters={"is_group": 0}, fields=["name"], limit=1)
			warehouse = any_wh[0]["name"] if any_wh else None
		except Exception:
			warehouse = None

	price_list = getattr(pos_doc, "selling_price_list", None)
	hide_unavailable = getattr(pos_doc, "hide_unavailable_items", False)

	return pos_doc, warehouse, price_list, hide_unavailable


def _fetch_batch_stock(item_codes: list, warehouse: str) -> dict:
	"""Fetch stock balances for multiple items using Stock Ledger Entries.

	Uses the same SLE-based source as ``fetch_item_balance`` /
	``get_stock_balance`` so that the initial product load and subsequent
	stock-refresh calls always agree on the numbers shown to the cashier.
	"""
	if not item_codes or not warehouse:
		return {}

	stock_map = {}

	try:
		placeholders = ", ".join(["%s"] * len(item_codes))
		now_date = frappe.utils.nowdate()
		now_time = frappe.utils.nowtime()

		sql = f"""
			SELECT sle.item_code, sle.qty_after_transaction
			FROM `tabStock Ledger Entry` sle
			INNER JOIN (
				SELECT item_code, MAX(posting_datetime) AS max_pd
				FROM `tabStock Ledger Entry`
				WHERE item_code IN ({placeholders})
				  AND warehouse = %s
				  AND is_cancelled = 0
				  AND posting_datetime <= CONCAT(%s, ' ', %s)
				GROUP BY item_code
			) latest
			  ON sle.item_code = latest.item_code
			 AND sle.posting_datetime = latest.max_pd
			 AND sle.warehouse = %s
			 AND sle.is_cancelled = 0
			ORDER BY sle.item_code, sle.creation DESC
		"""
		params = [*item_codes, warehouse, now_date, now_time, warehouse]
		results = frappe.db.sql(sql, params, as_dict=True)

		seen = set()
		for row in results:
			ic = row["item_code"]
			if ic not in seen:
				stock_map[ic] = row["qty_after_transaction"] or 0
				seen.add(ic)

		for item_code in item_codes:
			if item_code not in stock_map:
				stock_map[item_code] = 0

	except Exception:
		frappe.log_error(frappe.get_traceback(), "Batch stock fetch error (SLE)")
		for item_code in item_codes:
			stock_map[item_code] = fetch_item_balance(item_code, warehouse)

	return stock_map


def _fetch_batch_prices(item_codes: list, price_list: str | None, uom_map: dict) -> dict:
	"""Fetch selling and buying prices for multiple items in optimized batch queries."""
	if not item_codes:
		return {}

	price_map = {}

	try:
		# Get default currency
		default_currency = (
			frappe.get_value(
				"Company",
				frappe.defaults.get_user_default("Company"),
				"default_currency",
			)
			or "SAR"
		)
		default_symbol = frappe.db.get_value("Currency", default_currency, "symbol") or default_currency

		# Build query for Item Price with validity date filtering
		placeholders = ", ".join(["%s"] * len(item_codes))
		today = frappe.utils.nowdate()

		if price_list and price_list.strip():
			# Try with price list first, respecting validity dates
			sql = f"""
				SELECT item_code, price_list_rate, currency, uom
				FROM `tabItem Price`
				WHERE item_code IN ({placeholders})
				AND price_list = %s
				AND selling = 1
				AND (valid_from IS NULL OR valid_from <= %s)
				AND (valid_upto IS NULL OR valid_upto >= %s)
				ORDER BY valid_from DESC, creation DESC
			"""
			params = [*item_codes, price_list, today, today]
		else:
			sql = f"""
				SELECT item_code, price_list_rate, currency, uom
				FROM `tabItem Price`
				WHERE item_code IN ({placeholders})
				AND selling = 1
				AND (valid_from IS NULL OR valid_from <= %s)
				AND (valid_upto IS NULL OR valid_upto >= %s)
				ORDER BY valid_from DESC, creation DESC
			"""
			params = [*item_codes, today, today]

		results = frappe.db.sql(sql, params, as_dict=True)

		# Build price map - prefer prices matching the item's UOM
		for row in results:
			item_code = row["item_code"]
			item_uom = uom_map.get(item_code, "Nos")

			# If we already have a price for this item, only replace if UOM matches better
			if item_code in price_map:
				existing_uom_match = price_map[item_code].get("uom") == item_uom
				new_uom_match = row.get("uom") == item_uom
				if not new_uom_match or existing_uom_match:
					continue

			symbol = frappe.db.get_value("Currency", row["currency"], "symbol") or row["currency"]
			price_map[item_code] = {
				"price": row["price_list_rate"] or 0,
				"currency": row["currency"] or default_currency,
				"currency_symbol": symbol or default_symbol,
				"uom": row.get("uom"),
				"buying_price": 0,  # Will be populated below
			}

		# Fetch buying prices separately, respecting validity dates
		buying_sql = f"""
			SELECT item_code, price_list_rate, uom
			FROM `tabItem Price`
			WHERE item_code IN ({placeholders})
			AND buying = 1
			AND (valid_from IS NULL OR valid_from <= %s)
			AND (valid_upto IS NULL OR valid_upto >= %s)
			ORDER BY valid_from DESC, creation DESC
		"""
		buying_results = frappe.db.sql(buying_sql, [*item_codes, today, today], as_dict=True)

		# Build buying price map
		buying_price_map = {}
		for row in buying_results:
			item_code = row["item_code"]
			item_uom = uom_map.get(item_code, "Nos")

			# If we already have a buying price for this item, only replace if UOM matches better
			if item_code in buying_price_map:
				existing_uom_match = buying_price_map[item_code].get("uom") == item_uom
				new_uom_match = row.get("uom") == item_uom
				if not new_uom_match or existing_uom_match:
					continue

			buying_price_map[item_code] = {
				"buying_price": row["price_list_rate"] or 0,
				"uom": row.get("uom"),
			}

		# Fallback: fetch valuation_rate from Item table for items without Item Price buying entry
		items_without_buying_price = [ic for ic in item_codes if ic not in buying_price_map]
		if items_without_buying_price:
			valuation_placeholders = ", ".join(["%s"] * len(items_without_buying_price))
			valuation_sql = f"""
				SELECT name as item_code, valuation_rate
				FROM `tabItem`
				WHERE name IN ({valuation_placeholders})
				AND valuation_rate > 0
			"""
			valuation_results = frappe.db.sql(valuation_sql, items_without_buying_price, as_dict=True)
			for row in valuation_results:
				item_code = row["item_code"]
				if item_code not in buying_price_map:
					buying_price_map[item_code] = {
						"buying_price": row["valuation_rate"] or 0,
						"uom": None,
					}

		# Merge buying prices into price map
		for item_code in item_codes:
			if item_code in price_map:
				if item_code in buying_price_map:
					price_map[item_code]["buying_price"] = buying_price_map[item_code]["buying_price"]
			else:
				# Item not in selling prices, create entry
				buying_price = buying_price_map.get(item_code, {}).get("buying_price", 0)
				price_map[item_code] = {
					"price": 0,
					"currency": default_currency,
					"currency_symbol": default_symbol,
					"buying_price": buying_price,
				}

	except Exception:
		frappe.log_error(frappe.get_traceback(), "Batch price fetch error")
		# Fallback to individual queries
		for item_code in item_codes:
			uom = uom_map.get(item_code, "Nos")
			price_map[item_code] = fetch_item_price(item_code, price_list, uom=uom)
			price_map[item_code]["buying_price"] = 0

	return price_map


@frappe.whitelist(allow_guest=True)
def get_items_with_balance_and_price(
	limit: int = 1000,
	offset: int = 0,
	search: str | None = None,
	category: str | None = None,
):
	"""
	Get items with balance and price - optimized with pagination and server-side search.

	Args:
		limit: Number of items to return (default 1000)
		offset: Starting position for pagination (default 0)
		search: Search term to filter items by name, item_code, or barcode
		category: Filter by item group/category

	Returns:
		dict with items, total_count, and has_more flag
	"""
	# Convert string params to proper types (frappe passes strings from URL)
	try:
		limit = int(limit) if limit else 1000
		offset = int(offset) if offset else 0
	except (ValueError, TypeError):
		limit = 1000
		offset = 0

	# Cap limit to prevent abuse
	limit = min(limit, 2000)

	pos_doc, warehouse, price_list, hide_unavailable = _get_pos_context()

	try:
		# Build the base query
		select_fields = "i.name, i.item_name, i.description, i.item_group, i.image, i.stock_uom"

		if hide_unavailable:
			base_query = [
				f"SELECT DISTINCT {select_fields}",
				"FROM `tabItem` i",
				"INNER JOIN `tabBin` b ON i.name = b.item_code",
				"WHERE i.disabled = 0",
				"AND i.is_stock_item = 1",
				"AND b.actual_qty > 0",
			]
			count_query = [
				"SELECT COUNT(DISTINCT i.name) as total",
				"FROM `tabItem` i",
				"INNER JOIN `tabBin` b ON i.name = b.item_code",
				"WHERE i.disabled = 0",
				"AND i.is_stock_item = 1",
				"AND b.actual_qty > 0",
			]
		else:
			base_query = [
				f"SELECT DISTINCT {select_fields}",
				"FROM `tabItem` i",
				"WHERE i.disabled = 0",
				"AND i.is_stock_item = 1",
			]
			count_query = [
				"SELECT COUNT(DISTINCT i.name) as total",
				"FROM `tabItem` i",
				"WHERE i.disabled = 0",
				"AND i.is_stock_item = 1",
			]

		params_list: list[object] = []
		count_params: list[object] = []

		# Warehouse filter for hide_unavailable
		if hide_unavailable and warehouse:
			base_query.append("AND b.warehouse = %s")
			count_query.append("AND b.warehouse = %s")
			params_list.append(warehouse)
			count_params.append(warehouse)

		# Item group filter from POS profile
		if getattr(pos_doc, "item_groups", None):
			item_group_names = [d.item_group for d in pos_doc.item_groups if d.item_group]
			if item_group_names:
				placeholders = ", ".join(["%s"] * len(item_group_names))
				base_query.append(f"AND i.item_group IN ({placeholders})")
				count_query.append(f"AND i.item_group IN ({placeholders})")
				params_list.extend(item_group_names)
				count_params.extend(item_group_names)

		# Category filter (overrides POS profile groups if specified)
		if category and category != "all":
			base_query.append("AND i.item_group = %s")
			count_query.append("AND i.item_group = %s")
			params_list.append(category)
			count_params.append(category)

		# Search filter - search by name, item_code, description, or barcode
		if search and search.strip():
			search_term = f"%{search.strip()}%"
			# Join with Item Barcode to search by barcode
			search_condition = """
				AND (
					i.name LIKE %s
					OR i.item_name LIKE %s
					OR i.description LIKE %s
					OR EXISTS (
						SELECT 1 FROM `tabItem Barcode` ib
						WHERE ib.parent = i.name AND ib.barcode LIKE %s
					)
				)
			"""
			base_query.append(search_condition)
			count_query.append(search_condition)
			params_list.extend([search_term, search_term, search_term, search_term])
			count_params.extend([search_term, search_term, search_term, search_term])

		# Get total count - count ALL items matching filters (excluding stock availability for count)
		# This shows the real total even if hide_unavailable_items is enabled
		count_sql = "\n".join(count_query)
		total_result = frappe.db.sql(count_sql, tuple(count_params), as_dict=True)
		total_count = total_result[0]["total"] if total_result else 0

		# If hide_unavailable is enabled, we also need to count ALL items (without stock filter) for display
		# The actual items returned will still be filtered by stock, but count shows real total
		if hide_unavailable:
			# Build count query without stock filter to get real total
			unfiltered_count_query = [
				"SELECT COUNT(DISTINCT i.name) as total",
				"FROM `tabItem` i",
				"WHERE i.disabled = 0",
				"AND i.is_stock_item = 1",
			]
			unfiltered_count_params: list[object] = []

			# Apply item group filter from POS profile
			if getattr(pos_doc, "item_groups", None):
				item_group_names = [d.item_group for d in pos_doc.item_groups if d.item_group]
				if item_group_names:
					placeholders = ", ".join(["%s"] * len(item_group_names))
					unfiltered_count_query.append(f"AND i.item_group IN ({placeholders})")
					unfiltered_count_params.extend(item_group_names)

			# Apply category filter if specified
			if category and category != "all":
				unfiltered_count_query.append("AND i.item_group = %s")
				unfiltered_count_params.append(category)

			# Apply search filter if specified
			if search and search.strip():
				search_term = f"%{search.strip()}%"
				unfiltered_count_query.append("""
					AND (
						i.name LIKE %s
						OR i.item_name LIKE %s
						OR i.description LIKE %s
						OR EXISTS (
							SELECT 1 FROM `tabItem Barcode` ib
							WHERE ib.parent = i.name AND ib.barcode LIKE %s
						)
					)
				""")
				unfiltered_count_params.extend([search_term, search_term, search_term, search_term])

			# Get unfiltered total count
			unfiltered_count_sql = "\n".join(unfiltered_count_query)
			unfiltered_total_result = frappe.db.sql(
				unfiltered_count_sql, tuple(unfiltered_count_params), as_dict=True
			)
			unfiltered_total_count = unfiltered_total_result[0]["total"] if unfiltered_total_result else 0

			# Use the unfiltered count for display (real total)
			total_count = unfiltered_total_count

		# Add ordering and pagination
		base_query.append("ORDER BY i.item_name ASC")
		base_query.append("LIMIT %s OFFSET %s")
		params_list.extend([limit, offset])

		# Execute main query
		sql = "\n".join(base_query)
		items = frappe.db.sql(sql, tuple(params_list), as_dict=True)

		if not items:
			return {
				"items": [],
				"total_count": total_count,
				"has_more": False,
				"limit": limit,
				"offset": offset,
			}

		item_codes = [item["name"] for item in items]

		# Fetch barcodes in batch
		barcode_map = {}
		try:
			barcode_results = frappe.get_all(
				"Item Barcode",
				filters={"parent": ["in", item_codes]},
				fields=["parent", "barcode"],
				limit=0,
			)
			for barcode_row in barcode_results:
				item_code = barcode_row.get("parent")
				if item_code and item_code not in barcode_map:
					barcode_map[item_code] = barcode_row.get("barcode")
		except Exception:
			frappe.log_error(frappe.get_traceback(), "Error fetching item barcodes for POS")

		# Build UOM map for price fetching
		uom_map = {item["name"]: item.get("stock_uom", "Nos") for item in items}

		# Fetch stock and prices in batch (optimized)
		stock_map = _fetch_batch_stock(item_codes, warehouse)
		price_map = _fetch_batch_prices(item_codes, price_list, uom_map)

		# Build enriched items
		enriched_items = []
		for item in items:
			item_code = item["name"]
			balance = stock_map.get(item_code, 0)

			# Skip items with no stock if hide_unavailable is enabled
			if hide_unavailable and balance <= 0:
				continue

			default_uom = item.get("stock_uom", "Nos")
			price_info = price_map.get(item_code, {"price": 0, "currency": "SAR", "currency_symbol": "SAR"})
			primary_barcode = barcode_map.get(item_code)

			enriched_items.append(
				{
					"id": item_code,
					"name": item.get("item_name") or item_code,
					"description": item.get("description", ""),
					"category": item.get("item_group", "General"),
					"price": price_info["price"],
					"buying_price": price_info.get("buying_price", 0),
					"currency": price_info["currency"],
					"currency_symbol": price_info["currency_symbol"],
					"available": balance,
					"image": item.get("image"),
					"sold": 0,
					"preparationTime": 10,
					"uom": default_uom,
					"barcode": primary_barcode,
				}
			)

		has_more = (offset + len(enriched_items)) < total_count
		return {
			"items": enriched_items,
			"total_count": total_count,
			"has_more": has_more,
			"limit": limit,
			"offset": offset,
		}

	except Exception:
		frappe.log_error(frappe.get_traceback(), "Get Combined Item Data Error")
		frappe.throw(_("Something went wrong while fetching item data."))


@frappe.whitelist(allow_guest=True)
def get_stock_updates():
	"""Get only stock updates for all items - lightweight endpoint with early filtering."""
	pos_doc = None
	try:
		current_opening_entry = get_current_pos_opening_entry()
		if current_opening_entry:
			opening_doc = frappe.get_doc("POS Opening Entry", current_opening_entry)
			pos_doc = frappe.get_doc("POS Profile", opening_doc.pos_profile)
	except Exception:
		pos_doc = None

	if not pos_doc:
		pos_doc = get_current_pos_profile()

	warehouse = pos_doc.warehouse
	hide_unavailable = getattr(pos_doc, "hide_unavailable_items", False)

	try:
		if hide_unavailable:
			# Use SQL to get only items with stock > 0
			base_query = """
                SELECT DISTINCT i.name
                FROM `tabItem` i
                INNER JOIN `tabBin` b ON i.name = b.item_code
                WHERE i.disabled = 0
                AND i.is_stock_item = 1
                AND b.warehouse = %s
                AND b.actual_qty > 0
            """

			params = [warehouse]
			if pos_doc.item_groups:
				item_group_names = [d.item_group for d in pos_doc.item_groups if d.item_group]
				if item_group_names:
					placeholders = ", ".join(["%s"] * len(item_group_names))
					base_query += f" AND i.item_group IN ({placeholders})"
					params.extend(item_group_names)

			base_query += " ORDER BY i.modified DESC"

			# Execute query
			items = frappe.db.sql(base_query, params, as_dict=True)
			item_codes = [item["name"] for item in items]
		else:
			# Original logic for when hide_unavailable is disabled
			filters = {"disabled": 0, "is_stock_item": 1}
			if pos_doc.item_groups:
				item_group_names = [d.item_group for d in pos_doc.item_groups if d.item_group]
				if item_group_names:
					filters["item_group"] = ["in", item_group_names]

			items = frappe.get_all("Item", filters=filters, fields=["name"], order_by="modified desc")
			item_codes = [item["name"] for item in items]

		stock_updates = _fetch_batch_stock(item_codes, warehouse)

		if hide_unavailable:
			stock_updates = {k: v for k, v in stock_updates.items() if v > 0}

		return stock_updates

	except Exception:
		frappe.log_error(frappe.get_traceback(), "Get Stock Updates Error")
		return {}


@frappe.whitelist()
def get_item_detail_for_spa(item_code: str):
	"""
	Full Item document (with child tables) for POS SPA item detail page.
	Use GET from the client so Frappe does not require CSRF (unlike frappe.client.get POST).
	"""
	item_code = (item_code or "").strip()
	if not item_code:
		frappe.throw(_("Item code is required"))
	if not frappe.db.exists("Item", item_code):
		frappe.throw(_("Item {0} not found").format(item_code))
	frappe.has_permission("Item", "read", doc=item_code, throw=True)
	doc = frappe.get_doc("Item", item_code)
	return doc.as_dict()


@frappe.whitelist(allow_guest=True)
def get_item_stock(item_code: str):
	"""Get stock for a specific item - for individual updates."""
	pos_doc = get_current_pos_profile()
	warehouse = pos_doc.warehouse

	try:
		balance = fetch_item_balance(item_code, warehouse)
		return {"item_code": item_code, "available": balance, "warehouse": warehouse}
	except Exception:
		frappe.log_error(frappe.get_traceback(), f"Get Item Stock Error for {item_code}")
		return {"item_code": item_code, "available": 0, "warehouse": warehouse}


@frappe.whitelist(allow_guest=True)
def get_items_stock_batch(item_codes: str):
	"""Get stock for multiple specific items - uses same SLE query as initial load."""
	pos_doc = get_current_pos_profile()
	warehouse = pos_doc.warehouse
	hide_unavailable = getattr(pos_doc, "hide_unavailable_items", False)

	try:
		item_codes_list = [code.strip() for code in item_codes.split(",") if code.strip()]

		stock_updates = _fetch_batch_stock(item_codes_list, warehouse)

		if hide_unavailable:
			stock_updates = {k: v for k, v in stock_updates.items() if v > 0}

		return stock_updates
	except Exception:
		frappe.log_error(frappe.get_traceback(), f"Get Items Stock Batch Error for {item_codes}")
		return {}


@frappe.whitelist(allow_guest=True)
def get_item_groups_for_pos():
	try:
		pos_profile = get_current_pos_profile()

		formatted_groups = []
		# Determine allowed item groups from POS Profile (if configured)
		item_group_names = []
		if pos_profile.item_groups:
			item_group_names = [d.item_group for d in pos_profile.item_groups if d.item_group]

			item_groups = frappe.get_all(
				"Item Group",
				filters={"name": ["in", item_group_names], "is_group": 0},
				fields=["name", "item_group_name", "parent_item_group"],
			)
		else:
			# Fallback: fetch all leaf item groups
			item_groups = frappe.get_all(
				"Item Group",
				filters={"is_group": 0},
				fields=["name", "item_group_name"],
				limit=100,
				order_by="modified desc",
			)

		# Compute total items constrained to POS Profile's allowed groups (if any)
		if item_group_names:
			total_item_count = frappe.db.count(
				"Item",
				filters={
					"disabled": 0,
					"is_stock_item": 1,
					"item_group": ["in", item_group_names],
				},
			)
		else:
			total_item_count = frappe.db.count("Item", filters={"disabled": 0, "is_stock_item": 1})

		for group in item_groups:
			item_count = frappe.db.count("Item", filters={"item_group": group["name"]})

			formatted_groups.append(
				{
					"id": group["name"],
					"name": group.get("item_group_name") or group["name"],
					"parent": group.get("parent_item_group") or None,
					"icon": "📦",
					"count": item_count,
				}
			)
		return {"groups": formatted_groups, "total_items": total_item_count}

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"Get Item Groups for POS Error {e!s}")
		frappe.throw(_("Something went wrong while fetching item group data."))


@frappe.whitelist()
def get_batch_nos_with_qty(item_code):
	"""
	Returns a list of dicts with batch numbers and their actual quantities
	for a given item code and warehouse.
	"""
	pos_doc = get_current_pos_profile()
	warehouse = pos_doc.warehouse

	if not item_code or not warehouse:
		return []

	# Get all batches for the item
	batches = frappe.get_all("Batch", filters={"item": item_code}, fields=["name", "batch_id", "expiry_date"])

	batch_qty_data = []
	for b in batches:
		qty = _get_batch_qty_combined(b.name, warehouse)
		if qty > 0:
			batch_qty_data.append({"batch_id": b.batch_id, "qty": qty})

	return batch_qty_data


def _stock_entry_source_label(voucher_no: str | None) -> str:
	if not voucher_no:
		return _("Stock entry")
	row = frappe.db.get_value(
		"Stock Entry",
		voucher_no,
		["stock_entry_type", "purpose"],
		as_dict=True,
	)
	if not row:
		return _("Stock entry")
	purpose = (row.get("purpose") or "").lower()
	stype = (row.get("stock_entry_type") or "").lower()
	if "opening" in purpose or stype == "opening":
		return _("Opening")
	if "material transfer" in purpose or stype == "material transfer":
		return _("Transfer")
	if "material receipt" in purpose or stype == "material receipt":
		return _("Receipt")
	return _("Stock entry")


def _voucher_source_label(
	voucher_type: str | None,
	voucher_no: str | None,
	inbound_actual_qty: float | None = None,
) -> str:
	"""Label for the *latest inbound* SLE row (actual_qty > 0 in our queries)."""
	vt = (voucher_type or "").strip()
	# Positive qty on a Sales Invoice SLE = stock returned to warehouse (return / credit), not a normal sale.
	if vt == "Sales Invoice" and inbound_actual_qty is not None and flt(inbound_actual_qty) > 0:
		return _("Sales return")
	if vt == "Delivery Note" and inbound_actual_qty is not None and flt(inbound_actual_qty) > 0:
		return _("Return to stock")
	if vt == "Purchase Invoice":
		return _("Purchase")
	if vt == "Purchase Receipt":
		return _("Purchase")
	if vt == "Stock Entry":
		return _stock_entry_source_label(voucher_no)
	if vt:
		return _(vt)
	return _("Other")


def _fetch_earliest_purchase_invoice_for_batch(
	item_code: str, batch_name: str, batch_id: str | None = None
) -> dict | None:
	"""Earliest submitted PI line for this item + batch (match Batch name or same batch_id string)."""
	bid = (batch_id or "").strip()
	if bid and bid != batch_name:
		rows = frappe.db.sql(
			"""
			SELECT pii.rate, pi.supplier_name, pi.supplier, pi.posting_date, pi.name AS purchase_invoice,
				pi.currency
			FROM `tabPurchase Invoice Item` pii
			INNER JOIN `tabPurchase Invoice` pi ON pi.name = pii.parent AND pi.docstatus = 1
			WHERE pii.item_code = %s
				AND (pii.batch_no = %s OR pii.batch_no = %s)
			ORDER BY pi.posting_date ASC, pi.creation ASC, pi.name ASC
			LIMIT 1
			""",
			(item_code, batch_name, bid),
			as_dict=True,
		)
	else:
		rows = frappe.db.sql(
			"""
			SELECT pii.rate, pi.supplier_name, pi.supplier, pi.posting_date, pi.name AS purchase_invoice,
				pi.currency
			FROM `tabPurchase Invoice Item` pii
			INNER JOIN `tabPurchase Invoice` pi ON pi.name = pii.parent AND pi.docstatus = 1
			WHERE pii.item_code = %s AND pii.batch_no = %s
			ORDER BY pi.posting_date ASC, pi.creation ASC, pi.name ASC
			LIMIT 1
			""",
			(item_code, batch_name),
			as_dict=True,
		)
	return rows[0] if rows else None


def _fetch_pi_item_line_for_voucher(
	voucher_no: str, item_code: str, batch_name: str
) -> dict | None:
	"""When SLE points at a Purchase Invoice, load PI header + line for this item (prefer line with this batch)."""
	if not voucher_no or not frappe.db.exists("Purchase Invoice", voucher_no):
		return None
	rows = frappe.db.sql(
		"""
		SELECT pii.rate, pi.supplier_name, pi.supplier, pi.posting_date, pi.name AS purchase_invoice,
			pi.currency
		FROM `tabPurchase Invoice Item` pii
		INNER JOIN `tabPurchase Invoice` pi ON pi.name = pii.parent AND pi.docstatus = 1
		WHERE pi.name = %s AND pii.item_code = %s
		ORDER BY (CASE WHEN IFNULL(pii.batch_no, '') = %s THEN 0 ELSE 1 END), pii.idx ASC, pii.name ASC
		LIMIT 1
		""",
		(voucher_no, item_code, batch_name),
		as_dict=True,
	)
	return rows[0] if rows else None


def _fetch_pr_item_line_for_voucher(
	voucher_no: str, item_code: str, batch_name: str
) -> dict | None:
	"""Purchase Receipt line + supplier when last inbound SLE is a Purchase Receipt."""
	if not voucher_no or not frappe.db.exists("Purchase Receipt", voucher_no):
		return None
	rows = frappe.db.sql(
		"""
		SELECT pri.rate AS rate, pr.supplier_name, pr.supplier, pr.posting_date,
			NULL AS purchase_invoice, pr.currency,
			pr.name AS purchase_receipt
		FROM `tabPurchase Receipt Item` pri
		INNER JOIN `tabPurchase Receipt` pr ON pr.name = pri.parent AND pr.docstatus = 1
		WHERE pr.name = %s AND pri.item_code = %s
		ORDER BY (CASE WHEN IFNULL(pri.batch_no, '') = %s THEN 0 ELSE 1 END), pri.idx ASC, pri.name ASC
		LIMIT 1
		""",
		(voucher_no, item_code, batch_name),
		as_dict=True,
	)
	return rows[0] if rows else None


def _resolve_supplier_display(row: dict | None) -> str:
	if not row:
		return ""
	sn = (row.get("supplier_name") or "").strip()
	if sn:
		return sn
	sup = row.get("supplier")
	if sup:
		return frappe.db.get_value("Supplier", sup, "supplier_name") or str(sup)
	return ""


def _effective_incoming_rate_from_sle_row(row: dict) -> float:
	"""Best-effort unit rate from an inbound SLE row (batch_no or bundle-backed)."""
	r = flt(row.get("incoming_rate"))
	if r > 0:
		return r
	r = flt(row.get("valuation_rate"))
	if r > 0:
		return r
	aq = flt(row.get("actual_qty"))
	if aq > 0:
		svd = flt(row.get("stock_value_difference"))
		if svd != 0:
			return abs(svd) / aq
	return 0.0


def _normalize_sle_inbound_row(row: dict | None) -> dict | None:
	if not row:
		return None
	out = dict(row)
	out["incoming_rate"] = _effective_incoming_rate_from_sle_row(out)
	return out


def _fetch_latest_inbound_sle(item_code: str, batch_no: str, warehouse: str) -> dict | None:
	"""Latest positive actual_qty SLE for this batch: legacy batch_no on SLE, else Serial/Batch bundle lines.

	Prefer vouchers that represent stock-in for costing (exclude Sales Invoice / Delivery Note) when
	another qualifying row exists; fall back to any positive actual_qty row so returns still get a rate.
	"""
	exclude_customer_out = (
		" AND voucher_type NOT IN ('Sales Invoice', 'Delivery Note') "
	)

	def _legacy_sql(extra_where: str) -> list:
		return frappe.db.sql(
			f"""
			SELECT voucher_type, voucher_no, posting_date, posting_time,
				IFNULL(incoming_rate, 0) AS incoming_rate, creation,
				IFNULL(valuation_rate, 0) AS valuation_rate,
				IFNULL(actual_qty, 0) AS actual_qty,
				IFNULL(stock_value_difference, 0) AS stock_value_difference
			FROM `tabStock Ledger Entry`
			WHERE item_code = %s AND batch_no = %s AND warehouse = %s
				AND actual_qty > 0 AND IFNULL(is_cancelled, 0) = 0
				{extra_where}
			ORDER BY posting_date DESC, posting_time DESC, creation DESC
			LIMIT 1
			""",
			(item_code, batch_no, warehouse),
			as_dict=True,
		)

	def _bundle_sql(extra_where: str) -> list:
		return frappe.db.sql(
			f"""
			SELECT sle.voucher_type, sle.voucher_no, sle.posting_date, sle.posting_time,
				IFNULL(sle.incoming_rate, 0) AS incoming_rate, sle.creation,
				IFNULL(sle.valuation_rate, 0) AS valuation_rate,
				IFNULL(sle.actual_qty, 0) AS actual_qty,
				IFNULL(sle.stock_value_difference, 0) AS stock_value_difference
			FROM `tabStock Ledger Entry` sle
			INNER JOIN `tabSerial and Batch Bundle` sbb ON sbb.name = sle.serial_and_batch_bundle
			INNER JOIN `tabSerial and Batch Entry` sbe
				ON sbe.parent = sbb.name AND sbe.batch_no = %s AND sbe.warehouse = %s
			WHERE sle.item_code = %s
				AND sle.warehouse = %s
				AND sle.serial_and_batch_bundle IS NOT NULL
				AND sle.actual_qty > 0
				AND IFNULL(sle.is_cancelled, 0) = 0
				AND IFNULL(sbb.is_cancelled, 0) = 0
				AND sbb.docstatus = 1
				{extra_where.replace('voucher_type', 'sle.voucher_type')}
			ORDER BY sle.posting_date DESC, sle.posting_time DESC, sle.creation DESC
			LIMIT 1
			""",
			(batch_no, warehouse, item_code, warehouse),
			as_dict=True,
		)

	for extra in (exclude_customer_out, ""):
		rows = _legacy_sql(extra)
		if rows:
			return _normalize_sle_inbound_row(rows[0])
		rows = _bundle_sql(extra)
		if rows:
			return _normalize_sle_inbound_row(rows[0])
	return None


@frappe.whitelist()
def get_item_batch_stock_details(item_code):
	"""
	On-hand batches for item in current POS warehouse: qty, expiry, earliest PI, latest inbound SLE,
	source labels; summary for item detail card. Sorted by latest inbound activity (recent first).
	"""
	item_code = (item_code or "").strip()
	if not item_code:
		return {"success": False, "error": _("item_code is required")}

	try:
		pos_doc = get_current_pos_profile()
		warehouse = (getattr(pos_doc, "warehouse", None) or "").strip()
	except Exception:
		warehouse = ""
	currency = frappe.defaults.get_defaults().get("currency") or "USD"

	if not warehouse:
		return {
			"success": True,
			"warehouse": "",
			"currency": currency,
			"summary": {
				"total_qty": 0.0,
				"batch_count": 0,
				"avg_days_to_expiry": None,
				"avg_buying_rate": None,
			},
			"batches": [],
		}

	batches_meta = frappe.get_all(
		"Batch",
		filters={"item": item_code},
		fields=["name", "batch_id", "expiry_date", "modified", "creation"],
	)

	rows_out = []
	today_d = getdate(today())

	for b in batches_meta:
		bname = b.name
		qty = _get_batch_qty_combined(bname, warehouse)
		if qty <= 0:
			continue

		purchase_row = _fetch_earliest_purchase_invoice_for_batch(
			item_code, bname, b.get("batch_id")
		)
		sle_row = _fetch_latest_inbound_sle(item_code, bname, warehouse)

		if not purchase_row and sle_row:
			_vt = (sle_row.get("voucher_type") or "").strip()
			_vn = sle_row.get("voucher_no")
			if _vt == "Purchase Invoice" and _vn:
				purchase_row = _fetch_pi_item_line_for_voucher(_vn, item_code, bname)
			elif _vt == "Purchase Receipt" and _vn:
				purchase_row = _fetch_pr_item_line_for_voucher(_vn, item_code, bname)

		if purchase_row and purchase_row.get("currency"):
			currency = (purchase_row.get("currency") or "").strip() or currency

		expiry = b.get("expiry_date")
		days_left = None
		if expiry:
			days_left = (getdate(expiry) - today_d).days

		if sle_row:
			vt = sle_row.get("voucher_type")
			vn = sle_row.get("voucher_no")
			source_label = _voucher_source_label(vt, vn, flt(sle_row.get("actual_qty")))
			try:
				last_dt = get_datetime(
					f"{sle_row.get('posting_date')} {sle_row.get('posting_time') or '00:00:00'}"
				)
			except Exception:
				last_dt = sle_row.get("creation")
		else:
			source_label = _("On hand")
			try:
				last_dt = get_datetime(b.get("modified") or b.get("creation"))
			except Exception:
				last_dt = getdate(today_d)

		pi_rate = flt(purchase_row.get("rate")) if purchase_row else 0.0
		sle_rate = flt(sle_row.get("incoming_rate")) if sle_row else 0.0
		unit_buy = pi_rate if pi_rate > 0 else (sle_rate if sle_rate > 0 else None)

		display_supplier = _resolve_supplier_display(purchase_row)

		rows_out.append(
			{
				"batch_no": bname,
				"batch_id": b.get("batch_id") or bname,
				"qty": flt(qty),
				"expiry_date": str(expiry) if expiry else "",
				"days_to_expiry": days_left,
				"purchase_invoice": purchase_row.get("purchase_invoice") if purchase_row else None,
				"purchase_receipt": purchase_row.get("purchase_receipt") if purchase_row else None,
				"supplier_name": display_supplier,
				"pi_rate": round(pi_rate, 6) if pi_rate else None,
				"pi_posting_date": str(purchase_row.get("posting_date") or "") if purchase_row else "",
				"sle_voucher_type": sle_row.get("voucher_type") if sle_row else None,
				"sle_voucher_no": sle_row.get("voucher_no") if sle_row else None,
				"sle_posting_date": str(sle_row.get("posting_date") or "") if sle_row else "",
				"sle_incoming_rate": round(sle_rate, 6) if sle_rate else None,
				"source_label": str(source_label),
				"unit_buy_for_avg": unit_buy,
				"_sort_key": last_dt,
			}
		)

	def _sort_ts(val):
		if val is None:
			return 0.0
		try:
			d = get_datetime(val)
			return d.timestamp() if d else 0.0
		except Exception:
			return 0.0

	rows_out.sort(key=lambda r: _sort_ts(r.get("_sort_key")), reverse=True)
	for r in rows_out:
		r.pop("_sort_key", None)

	total_qty = sum(flt(x["qty"]) for x in rows_out)
	batch_count = len(rows_out)

	exp_num = exp_den = 0.0
	for x in rows_out:
		if x.get("days_to_expiry") is not None:
			exp_num += flt(x["qty"]) * float(x["days_to_expiry"])
			exp_den += flt(x["qty"])
	avg_days = round(exp_num / exp_den, 2) if exp_den > 0 else None

	cost_num = cost_den = 0.0
	for x in rows_out:
		ub = x.pop("unit_buy_for_avg", None)
		if ub is not None and flt(ub) > 0:
			cost_num += flt(x["qty"]) * flt(ub)
			cost_den += flt(x["qty"])
	avg_buy = round(cost_num / cost_den, 6) if cost_den > 0 else None

	return {
		"success": True,
		"warehouse": warehouse,
		"currency": currency,
		"summary": {
			"total_qty": round(total_qty, 6),
			"batch_count": batch_count,
			"avg_days_to_expiry": avg_days,
			"avg_buying_rate": avg_buy,
		},
		"batches": rows_out,
	}


@frappe.whitelist()
def get_item_uoms_and_prices(item_code, customer=None):
	"""
	Returns a list of UOMs and their prices for a given item code.
	Returns UOMs from Item UOM table and prices from Item Price doctype.
	Uses customer-first price list priority.
	"""
	if not item_code:
		return {}

	try:
		# Get the price list with customer-first priority
		price_list = get_price_list_with_customer_priority(customer)

		item_doc = frappe.get_doc("Item", item_code)

		uom_data = []

		# Get all UOMs from child table
		uom_names_in_table = set()
		for uom_row in item_doc.get("uoms", []):
			uom_names_in_table.add(uom_row.uom)
			uom_data.append(
				{
					"uom": uom_row.uom,
					"conversion_factor": uom_row.conversion_factor,
					"price": 0.0,
				}
			)

		# Add stock_uom if it's not already in the list (stock_uom has conversion_factor of 1.0)
		stock_uom = item_doc.stock_uom
		if stock_uom and stock_uom not in uom_names_in_table:
			uom_data.insert(
				0,
				{
					"uom": stock_uom,
					"conversion_factor": 1.0,
					"price": 0.0,
				},
			)

		for uom_info in uom_data:
			# First, check if there's a direct price entry for this UOM
			direct_price_filters = {
				"item_code": item_code,
				"uom": uom_info["uom"],
				"selling": 1,
			}
			if price_list and price_list.strip():
				direct_price_filters["price_list"] = price_list

			direct_price = frappe.db.get_value(
				"Item Price",
				direct_price_filters,
				"price_list_rate",
			)

			# If no direct price with price_list, try without price_list
			if not direct_price and price_list:
				direct_price_filters.pop("price_list", None)
				direct_price = frappe.db.get_value(
					"Item Price",
					direct_price_filters,
					"price_list_rate",
					order_by="modified desc",
				)

			if direct_price:
				# Use direct price if found
				uom_info["price"] = float(direct_price)
			else:
				# No direct price found - calculate from base UOM using conversion factor
				# Get base UOM price with customer-first priority
				base_price_info = fetch_item_price(
					item_code, price_list=price_list, customer=customer, uom=item_doc.stock_uom
				)

				if base_price_info and base_price_info.get("price", 0) > 0:
					converted_price = float(base_price_info["price"]) * uom_info["conversion_factor"]
					uom_info["price"] = converted_price
				else:
					# Last resort: use valuation_rate with conversion factor
					valuation_rate = frappe.db.get_value("Item", item_code, "valuation_rate") or 0
					converted_price = float(valuation_rate) * uom_info["conversion_factor"]
					uom_info["price"] = converted_price

		return {
			"base_uom": item_doc.stock_uom,
			"uoms": uom_data,
			"price_list_used": price_list,
		}
	except Exception:
		frappe.log_error(frappe.get_traceback(), f"Get Item UOMs Error for {item_code}")
		return {
			"base_uom": "Nos",
			"uoms": [{"uom": "Nos", "conversion_factor": 1.0, "price": 0.0}],
		}


@frappe.whitelist(allow_guest=True)
def get_serial_nos_for_item(item_code: str):
	"""
	Returns a list of available Serial Nos for a given item (and POS warehouse if set).
	"""
	if not item_code:
		return []

	try:
		pos_doc = get_current_pos_profile()
		warehouse = getattr(pos_doc, "warehouse", None)

		filters = {"item_code": item_code, "status": ["in", ["Active", "Available"]]}
		if warehouse:
			filters["warehouse"] = warehouse

		serials = frappe.get_all(
			"Serial No",
			filters=filters,
			fields=["name", "serial_no"],
			limit=500,
			order_by="modified desc",
		)

		# Normalize: prefer serial_no field if present; fallback to name
		result = []
		for s in serials:
			serial_value = s.get("serial_no") or s.get("name")
			if serial_value:
				result.append({"serial_no": serial_value})

		return result
	except Exception:
		frappe.log_error(frappe.get_traceback(), f"Get Serial Nos Error for {item_code}")
		return []


@frappe.whitelist(allow_guest=True)
def apply_pricing_rules_to_cart(cart_items, customer=None):
	"""
	Apply ERPNext pricing rules to cart items.

	Args:
		cart_items: List of cart items with item_code, qty, price, uom, etc.
		customer: Customer ID (optional)

	Returns:
		List of items with updated prices, discounts, and pricing rule info
	"""
	try:
		cart_items = _parse_cart_items(cart_items)
		if not cart_items:
			return []

		context = _build_pricing_context(customer)
		erpnext_items = _prepare_erpnext_items(cart_items, context)

		if not erpnext_items:
			return []
		pricing_results = _apply_pricing_rules(erpnext_items, context)

		result_items = _process_pricing_results(pricing_results, erpnext_items, cart_items, context)
		return result_items

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"Error applying pricing rules to cart: {e!s}")
		return cart_items


def _parse_cart_items(cart_items):
	"""Parse cart items from JSON string if needed."""
	if isinstance(cart_items, str):
		import json

		return json.loads(cart_items)
	return cart_items


def _build_pricing_context(customer=None):
	"""Build context object with POS profile, company, and customer details."""
	pos_profile = get_current_pos_profile()
	company = pos_profile.company if pos_profile else frappe.defaults.get_user_default("Company")

	context = {
		"pos_profile": pos_profile,
		"company": company,
		"warehouse": pos_profile.warehouse if pos_profile else None,
		"price_list": pos_profile.selling_price_list if pos_profile else None,
		"currency": frappe.get_cached_value("Company", company, "default_currency") or "SAR",
		"customer": customer,
		"customer_group": None,
		"territory": None,
	}

	if customer:
		customer_doc = frappe.get_cached_value(
			"Customer", customer, ["customer_group", "territory"], as_dict=True
		)
		if customer_doc:
			context["customer_group"] = customer_doc.customer_group
			context["territory"] = customer_doc.territory

	return context


def _prepare_erpnext_items(cart_items, context):
	"""Convert cart items to ERPNext pricing rule format."""
	erpnext_items = []

	for item in cart_items:
		item_code = item.get("id") or item.get("item_code")
		if not item_code:
			continue

		item_doc = frappe.get_cached_value("Item", item_code, ["item_group", "brand"], as_dict=True)

		if not item_doc:
			continue

		# Get original price from backend to pass to pricing rule
		# This ensures pricing rules work with correct base price
		item_uom = item.get("uom") or frappe.get_cached_value("Item", item_code, "stock_uom")
		# Use context for price_list and customer to ensure correct price calculation
		price_list = context.get("price_list")
		customer = context.get("customer")

		# First check for direct price entry for this UOM (same logic as get_item_uoms_and_prices)
		direct_price_filters = {
			"item_code": item_code,
			"uom": item_uom,
			"selling": 1,
		}
		if price_list and price_list.strip():
			direct_price_filters["price_list"] = price_list

		direct_price = frappe.db.get_value(
			"Item Price",
			direct_price_filters,
			"price_list_rate",
		)

		# If no direct price with price_list, try without price_list
		if not direct_price and price_list:
			direct_price_filters.pop("price_list", None)
			direct_price = frappe.db.get_value(
				"Item Price",
				direct_price_filters,
				"price_list_rate",
				order_by="modified desc",
			)

		if direct_price:
			# Use direct price if found
			base_price = float(direct_price)
		else:
			# No direct price - calculate from base UOM using conversion factor
			item_doc = frappe.get_doc("Item", item_code)
			stock_uom = item_doc.stock_uom

			# Get base UOM price
			base_price_info = fetch_item_price(
				item_code, price_list=price_list, customer=customer, uom=stock_uom
			)
			base_uom_price = (
				base_price_info.get("price", 0)
				if base_price_info.get("price", 0) > 0
				else item.get("price", 0)
			)

			# If UOM is different from stock_uom, apply conversion factor
			if item_uom and item_uom != stock_uom:
				conversion_factor = _get_uom_conversion_factor(item_code, item_uom)
				if conversion_factor:
					base_price = float(base_uom_price) * conversion_factor
				else:
					base_price = base_uom_price
			else:
				base_price = base_uom_price

		# Fallback to cart item price if calculation failed
		if base_price <= 0:
			base_price = item.get("price", 0)

		item_qty = item.get("quantity", 1)

		# Get conversion factor for the UOM to calculate stock_qty correctly
		item_doc_full = frappe.get_doc("Item", item_code)
		stock_uom = item_doc_full.stock_uom
		conversion_factor = 1.0
		if item_uom and item_uom != stock_uom:
			uom_conversion = _get_uom_conversion_factor(item_code, item_uom)
			if uom_conversion:
				conversion_factor = uom_conversion

		stock_qty = item_qty * conversion_factor

		erpnext_item = {
			"doctype": "Sales Invoice Item",
			"name": "",
			"item_code": item_code,
			"item_group": item_doc.item_group,
			"brand": item_doc.brand or "",
			"qty": item_qty,
			"stock_qty": stock_qty,  # filter_pricing_rules uses stock_qty for filtering
			"price_list_rate": base_price,  # Use calculated price with UOM conversion
			"uom": item_uom,
			"conversion_factor": conversion_factor,
		}

		erpnext_items.append(erpnext_item)

	return erpnext_items


def _apply_pricing_rules(erpnext_items, context):
	"""Call ERPNext's pricing rule engine."""
	# Build args dict - always include customer_group and territory from customer
	args_dict = {
		"items": erpnext_items,
		"company": context["company"],
		"currency": context["currency"],
		"transaction_date": frappe.utils.today(),
		"transaction_type": "selling",
		"conversion_rate": 1.0,
		"plc_conversion_rate": 1.0,
	}

	# Always include customer if it exists
	if context.get("customer"):
		args_dict["customer"] = context["customer"]

	# Always include customer_group and territory if available (needed for pricing rule filtering)
	if context.get("customer_group"):
		args_dict["customer_group"] = context["customer_group"]
	if context.get("territory"):
		args_dict["territory"] = context["territory"]

	# Add other optional fields
	if context.get("price_list"):
		args_dict["price_list"] = context["price_list"]
	if context.get("warehouse"):
		args_dict["warehouse"] = context["warehouse"]

	args = frappe._dict(args_dict)

	try:
		results = apply_pricing_rule(args, doc=None)
	except Exception as e:
		import traceback

		frappe.log_error(
			message=f"Error in apply_pricing_rule: {e!s}\n{traceback.format_exc()}",
			title="Pricing Rule Error",
		)
		results = []

	return results


def _process_pricing_results(pricing_results, erpnext_items, cart_items, context):
	"""Process pricing rule results and map back to cart items."""
	result_items = []

	# Create a map from item_code to cart_item for quick lookup
	cart_item_map = {}
	for cart_item in cart_items:
		cart_item_code = cart_item.get("id") or cart_item.get("item_code")
		if cart_item_code:
			cart_item_map[cart_item_code] = cart_item

	# Process each pricing result - they correspond to erpnext_items by index
	for idx, pricing_result in enumerate(pricing_results):
		if idx >= len(erpnext_items):
			continue

		# Get the item_code from the corresponding erpnext_item
		erpnext_item = erpnext_items[idx]
		item_code = erpnext_item.get("item_code")

		if not item_code:
			continue

		# Find the matching cart item
		cart_item = cart_item_map.get(item_code)
		if not cart_item:
			continue

		# Check if pricing rule was applied
		has_rule = _has_pricing_rule(pricing_result)

		if not has_rule:
			# No pricing rule - get original price from backend
			result_items.extend(
				_handle_no_pricing_rule(
					erpnext_item,
					[cart_item],  # Pass single item as list
					context,
				)
			)
			continue

		# Pricing rule was applied - calculate discounted price
		processed_item = _calculate_discounted_price(cart_item, pricing_result, context)
		result_items.append(processed_item)

	# Add unprocessed cart items (items not in erpnext_items)
	processed_item_codes = {item.get("id") or item.get("item_code") for item in result_items}
	for cart_item in cart_items:
		cart_item_code = cart_item.get("id") or cart_item.get("item_code")
		if cart_item_code and cart_item_code not in processed_item_codes:
			result_items.append(cart_item)

	return result_items


def _has_pricing_rule(pricing_result):
	"""Check if pricing result contains a valid pricing rule."""
	pricing_rules_json = pricing_result.get("pricing_rules", "")
	has_rule = pricing_result.get("has_pricing_rule", 0)
	result = bool(pricing_rules_json and has_rule)

	return result


def _extract_pricing_rule_names(pricing_result):
	"""Extract pricing rule names from JSON string."""
	import json

	try:
		pricing_rules_json = pricing_result.get("pricing_rules", "")
		return json.loads(pricing_rules_json)
	except (json.JSONDecodeError, TypeError):
		return []


def _handle_no_pricing_rule(erpnext_item, cart_items, context):
	"""Handle items without pricing rules - return with original price."""
	item_code = erpnext_item.get("item_code")
	if not item_code:
		return []

	for cart_item in cart_items:
		cart_item_code = cart_item.get("id") or cart_item.get("item_code")
		if cart_item_code == item_code:
			item_uom = cart_item.get("uom")
			price_list = context.get("price_list")
			customer = context.get("customer")

			# Use same logic as _prepare_erpnext_items: check direct price first, then calculate
			direct_price_filters = {
				"item_code": cart_item_code,
				"uom": item_uom,
				"selling": 1,
			}
			if price_list and price_list.strip():
				direct_price_filters["price_list"] = price_list

			direct_price = frappe.db.get_value(
				"Item Price",
				direct_price_filters,
				"price_list_rate",
			)

			if not direct_price and price_list:
				direct_price_filters.pop("price_list", None)
				direct_price = frappe.db.get_value(
					"Item Price",
					direct_price_filters,
					"price_list_rate",
					order_by="modified desc",
				)

			if direct_price:
				original_price = float(direct_price)
			else:
				# Calculate from base UOM, but prefer cart item price if it's already set correctly
				cart_price = cart_item.get("price", 0)

				# If cart already has a price > 0, check if it makes sense for this UOM
				if cart_price > 0 and item_uom:
					item_doc = frappe.get_doc("Item", cart_item_code)
					stock_uom = item_doc.stock_uom

					# Get base UOM price to validate cart price
					base_price_info = fetch_item_price(
						cart_item_code, price_list=price_list, customer=customer, uom=stock_uom
					)
					base_uom_price = base_price_info.get("price", 0)

					if base_uom_price > 0:
						if item_uom != stock_uom:
							conversion_factor = _get_uom_conversion_factor(cart_item_code, item_uom)
							if conversion_factor:
								expected_price = float(base_uom_price) * conversion_factor
								# If cart price is close to expected (within 5%), use cart price
								if abs(cart_price - expected_price) / max(cart_price, expected_price) < 0.05:
									original_price = cart_price
								else:
									original_price = expected_price
							else:
								original_price = cart_price
						else:
							# Same UOM, use cart price if close to base price
							if abs(cart_price - base_uom_price) / max(cart_price, base_uom_price) < 0.05:
								original_price = cart_price
							else:
								original_price = base_uom_price
					else:
						# No base price found, use cart price
						original_price = cart_price
				else:
					# No cart price or UOM, calculate normally
					item_doc = frappe.get_doc("Item", cart_item_code)
					stock_uom = item_doc.stock_uom
					base_price_info = fetch_item_price(
						cart_item_code, price_list=price_list, customer=customer, uom=stock_uom
					)
					base_uom_price = (
						base_price_info.get("price", 0) if base_price_info.get("price", 0) > 0 else 0
					)

					if item_uom and item_uom != stock_uom:
						conversion_factor = _get_uom_conversion_factor(cart_item_code, item_uom)
						if conversion_factor and base_uom_price > 0:
							original_price = float(base_uom_price) * conversion_factor
						else:
							original_price = base_uom_price if base_uom_price > 0 else cart_price
					else:
						original_price = base_uom_price if base_uom_price > 0 else cart_price

			# Final fallback to cart item price
			if original_price <= 0:
				original_price = cart_item.get("price", 0)

			return [
				{
					**cart_item,
					"price": original_price,
					"original_price": original_price,
				}
			]

	return []


def _calculate_discounted_price(cart_item, pricing_result, context):
	"""Calculate final price after applying discounts."""
	cart_item_code = cart_item.get("id") or cart_item.get("item_code")
	item_uom = cart_item.get("uom")
	price_list = context.get("price_list")
	customer = context.get("customer")

	# Use same logic as _prepare_erpnext_items: check direct price first, then calculate
	direct_price_filters = {
		"item_code": cart_item_code,
		"uom": item_uom,
		"selling": 1,
	}
	if price_list and price_list.strip():
		direct_price_filters["price_list"] = price_list

	direct_price = frappe.db.get_value(
		"Item Price",
		direct_price_filters,
		"price_list_rate",
	)

	if not direct_price and price_list:
		direct_price_filters.pop("price_list", None)
		direct_price = frappe.db.get_value(
			"Item Price",
			direct_price_filters,
			"price_list_rate",
			order_by="modified desc",
		)

	if direct_price:
		original_price = float(direct_price)
	else:
		# Calculate from base UOM, but prefer cart item price if it's already set correctly
		cart_price = cart_item.get("price", 0)

		# If cart already has a price > 0, check if it makes sense for this UOM
		if cart_price > 0 and item_uom:
			item_doc = frappe.get_doc("Item", cart_item_code)
			stock_uom = item_doc.stock_uom

			# Get base UOM price to validate cart price
			base_price_info = fetch_item_price(
				cart_item_code, price_list=price_list, customer=customer, uom=stock_uom
			)
			base_uom_price = base_price_info.get("price", 0)

			if base_uom_price > 0:
				if item_uom != stock_uom:
					conversion_factor = _get_uom_conversion_factor(cart_item_code, item_uom)
					if conversion_factor:
						expected_price = float(base_uom_price) * conversion_factor
						# If cart price is close to expected (within 5%), use cart price
						if abs(cart_price - expected_price) / max(cart_price, expected_price) < 0.05:
							original_price = cart_price
						else:
							original_price = expected_price
					else:
						original_price = cart_price
				else:
					# Same UOM, use cart price if close to base price
					if abs(cart_price - base_uom_price) / max(cart_price, base_uom_price) < 0.05:
						original_price = cart_price
					else:
						original_price = base_uom_price
			else:
				# No base price found, use cart price
				original_price = cart_price
		else:
			# No cart price or UOM, calculate normally
			item_doc = frappe.get_doc("Item", cart_item_code)
			stock_uom = item_doc.stock_uom
			base_price_info = fetch_item_price(
				cart_item_code, price_list=price_list, customer=customer, uom=stock_uom
			)
			base_uom_price = base_price_info.get("price", 0) if base_price_info.get("price", 0) > 0 else 0

			if item_uom and item_uom != stock_uom:
				conversion_factor = _get_uom_conversion_factor(cart_item_code, item_uom)
				if conversion_factor and base_uom_price > 0:
					original_price = float(base_uom_price) * conversion_factor
				else:
					original_price = base_uom_price if base_uom_price > 0 else cart_price
			else:
				original_price = base_uom_price if base_uom_price > 0 else cart_price

	# Final fallback to cart item price
	if original_price <= 0:
		original_price = cart_item.get("price", 0)

	# Validate that pricing_result price_list_rate makes sense for the UOM
	# If pricing rule returns a price that's way off from expected UOM price,
	# it means ERPNext calculated discount for wrong UOM - recalculate using our original_price
	pricing_result_rate = pricing_result.get("price_list_rate")
	_has_pricing_rule = pricing_result.get("has_pricing_rule", 0)
	discount_percentage = pricing_result.get("discount_percentage", 0) or 0
	discount_amount = pricing_result.get("discount_amount", 0) or 0
	_pricing_rules_json = pricing_result.get("pricing_rules", "")

	if pricing_result_rate is not None and item_uom and original_price > 0:
		# If the pricing_result_rate is significantly different from our calculated original_price
		# (more than 50% difference), it's likely calculated for wrong UOM
		price_diff_ratio = abs(pricing_result_rate - original_price) / max(
			pricing_result_rate, original_price
		)
		if price_diff_ratio > 0.5:
			# Pricing rule returned price for wrong UOM, recalculate discount on correct UOM price
			# Extract discount info and apply to our correct original_price
			discount_percentage = pricing_result.get("discount_percentage", 0) or 0
			discount_amount = pricing_result.get("discount_amount", 0) or 0

			# Calculate what the discount should be based on the difference
			# If pricing_result_rate is much lower, calculate the discount percentage
			if pricing_result_rate < original_price:
				calculated_discount_pct = ((original_price - pricing_result_rate) / original_price) * 100
				# Use the calculated discount or the one from pricing_result
				effective_discount = (
					discount_percentage if discount_percentage > 0 else calculated_discount_pct
				)
				if effective_discount > 0:
					final_price = original_price * (1 - effective_discount / 100)
				elif discount_amount > 0:
					final_price = max(0, original_price - discount_amount)
				else:
					final_price = original_price
			else:
				# Use discount from pricing_result
				if discount_percentage > 0:
					final_price = original_price * (1 - discount_percentage / 100)
				elif discount_amount > 0:
					final_price = max(0, original_price - discount_amount)
				else:
					final_price = original_price

			# Return early with recalculated price
			final_discount_pct = (
				discount_percentage
				if discount_percentage > 0
				else ((original_price - final_price) / original_price * 100)
			)
			final_discount_amt = discount_amount if discount_amount > 0 else (original_price - final_price)

			return {
				**cart_item,
				"price": final_price,
				"original_price": original_price,
				"discount_percentage": final_discount_pct,
				"discount_amount": final_discount_amt,
				"pricing_rules": pricing_result.get("pricing_rules", ""),
				"has_pricing_rule": pricing_result.get("has_pricing_rule", 0),
				"free_item_data": pricing_result.get("free_item_data", []),
			}

	# Calculate final price based on pricing rule type
	final_price = _apply_discount_logic(original_price, pricing_result)

	# Build result item with all pricing information
	return {
		**cart_item,
		"price": final_price,
		"original_price": original_price,
		"discount_percentage": pricing_result.get("discount_percentage", 0) or 0,
		"discount_amount": pricing_result.get("discount_amount", 0) or 0,
		"pricing_rules": pricing_result.get("pricing_rules", ""),
		"has_pricing_rule": pricing_result.get("has_pricing_rule", 0),
		"free_item_data": pricing_result.get("free_item_data", []),
	}


def _apply_discount_logic(original_price, pricing_result):
	"""Apply discount based on pricing rule type."""
	pricing_rule_for = pricing_result.get("pricing_rule_for", "")
	discount_percentage = pricing_result.get("discount_percentage", 0) or 0
	discount_amount = pricing_result.get("discount_amount", 0) or 0
	price_list_rate = pricing_result.get("price_list_rate")

	if price_list_rate is not None:
		if pricing_rule_for == "Rate":
			# Explicitly Rate type - use the rate
			return price_list_rate
		elif price_list_rate != original_price:
			# Use it even if pricing_rule_for is not set correctly
			return price_list_rate

	# Apply discount based on type
	if pricing_rule_for == "Discount Percentage":
		# Use percentage discount
		if discount_percentage > 0:
			return original_price * (1 - discount_percentage / 100)
		# discount_amount is already calculated from percentage, don't subtract it again

	elif pricing_rule_for == "Discount Amount":
		# Use amount discount
		if discount_amount > 0:
			return max(0, original_price - discount_amount)

	# Fallback: try percentage first, then amount
	if discount_percentage > 0:
		return original_price * (1 - discount_percentage / 100)
	elif discount_amount > 0:
		return max(0, original_price - discount_amount)

	return original_price


def _add_unprocessed_items(result_items, cart_items):
	"""Add cart items that weren't processed by pricing rules."""
	processed_item_codes = {item.get("id") or item.get("item_code") for item in result_items}

	for cart_item in cart_items:
		cart_item_code = cart_item.get("id") or cart_item.get("item_code")
		if cart_item_code and cart_item_code not in processed_item_codes:
			result_items.append(cart_item)


def _save_item_image(item_code: str, item_name: str, image_data: str) -> str | None:
	"""
	Save base64 encoded image data as a file and return the file URL.
	
	Args:
		item_code: Item code for naming the file
		item_name: Item name for file description
		image_data: Base64 encoded image data (data:image/jpeg;base64,...)
	
	Returns:
		File URL or None if failed
	"""
	import base64
	import re
	
	try:
		# Extract base64 data from data URL
		match = re.match(r'data:image/(\w+);base64,(.+)', image_data)
		if not match:
			frappe.log_error("Invalid image data format", f"Image upload for {item_code}")
			return None
		
		image_format = match.group(1)
		base64_data = match.group(2)
		
		# Decode base64
		image_bytes = base64.b64decode(base64_data)
		
		# Generate filename
		safe_item_code = re.sub(r'[^a-zA-Z0-9_-]', '_', item_code)
		filename = f"item_{safe_item_code}.{image_format}"
		
		# Save as file using Frappe's file handler
		file_doc = frappe.get_doc({
			"doctype": "File",
			"file_name": filename,
			"attached_to_doctype": "Item",
			"attached_to_name": item_code,
			"is_private": 0,
			"content": image_bytes,
		})
		file_doc.save(ignore_permissions=True)
		
		return file_doc.file_url
		
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"Error saving image for {item_code}: {str(e)}")
		return None


@frappe.whitelist()
def create_item_with_barcode(
	item_name: str,
	item_code: str | None = None,
	item_group: str = "Products",
	stock_uom: str = "Nos",
	barcode: str | None = None,
	use_item_code_as_barcode: int = 0,
	has_batch_no: int = 0,
	has_expiry_date: int = 0,
	shelf_life_in_days: int | None = None,
	selling_price: float = 0,
	buying_price: float = 0,
	opening_stock: float = 0,
	batch_no: str | None = None,
	expiry_date: str | None = None,
	image_data: str | None = None,
):
	"""
	Create a new item with optional barcode, pricing, opening stock, and image.
	
	Args:
		item_name: Name of the item (required)
		item_code: Item code (auto-generated if not provided)
		item_group: Item group (default: Products)
		stock_uom: Stock UOM (default: Nos)
		barcode: Barcode to assign to item
		use_item_code_as_barcode: If 1, generate a unique EAN-13 standard barcode (0 or 1)
		has_batch_no: Whether item has batch tracking (0 or 1)
		has_expiry_date: Whether item has expiry tracking (0 or 1)
		shelf_life_in_days: Shelf life in days for expiry calculation
		selling_price: Selling price
		buying_price: Buying/valuation price
		opening_stock: Opening stock quantity
		batch_no: Batch number (if has_batch_no is enabled)
		expiry_date: Expiry date for batch
		image_data: Base64 encoded image data (data:image/jpeg;base64,...)
	
	Returns:
		dict with item details
	"""
	try:
		# Generate item_code if not provided (do this first so we can use it for barcode)
		if not item_code or not item_code.strip():
			# Use item name based code
			base_code = item_name.upper().replace(" ", "-")[:20]
			item_code = f"{base_code}-{frappe.generate_hash(length=6).upper()}"
		
		# Check if item_code already exists
		if frappe.db.exists("Item", item_code):
			frappe.throw(_("Item code '{0}' already exists").format(item_code))
		
		# Handle barcode - generate unique EAN-13 barcode if flag is set
		if use_item_code_as_barcode:
			barcode = _generate_unique_barcode()
		# Ignore placeholder if it was sent (shouldn't happen with frontend fix, but for safety)
		elif barcode and barcode.strip() == '__USE_ITEM_CODE__':
			barcode = None
		
		# Check if barcode already exists (generated barcodes are already checked for uniqueness)
		if barcode and barcode.strip() and not use_item_code_as_barcode:
			existing = frappe.db.exists("Item Barcode", {"barcode": barcode})
			if existing:
				frappe.throw(_("Barcode '{0}' is already assigned to another item").format(barcode))
		
		# Get default company
		company = frappe.defaults.get_user_default("Company") or frappe.db.get_single_value(
			"Global Defaults", "default_company"
		)
		
		# Create the item
		item_doc = frappe.get_doc({
			"doctype": "Item",
			"item_code": item_code,
			"item_name": item_name,
			"item_group": item_group,
			"stock_uom": stock_uom,
			"is_stock_item": 1,
			"has_batch_no": has_batch_no,
			"create_new_batch": 1 if has_batch_no else 0,
			"has_expiry_date": has_expiry_date,
			"shelf_life_in_days": shelf_life_in_days if shelf_life_in_days and shelf_life_in_days > 0 else None,
			"valuation_rate": buying_price or 0,
			"standard_rate": selling_price or 0,
		})
		
		# Add barcode to child table
		if barcode and barcode.strip():
			barcode_value = barcode.strip()
			barcode_type = _detect_barcode_type(barcode_value)
			barcode_entry = {"barcode": barcode_value}
			if barcode_type:
				barcode_entry["barcode_type"] = barcode_type
			item_doc.append("barcodes", barcode_entry)
		
		item_doc.insert(ignore_permissions=True)
		
		# Save image if provided
		if image_data and image_data.strip():
			try:
				image_url = _save_item_image(item_code, item_name, image_data)
				if image_url:
					item_doc.image = image_url
					item_doc.save(ignore_permissions=True)
			except Exception as img_err:
				frappe.log_error(frappe.get_traceback(), f"Error saving image for {item_code}")
		
		# Create Item Price for selling
		if selling_price and selling_price > 0:
			try:
				# Get default price list
				price_list = frappe.db.get_single_value("Selling Settings", "selling_price_list")
				if not price_list:
					price_list = frappe.db.get_value("Price List", {"selling": 1, "enabled": 1}, "name")
				
				if price_list:
					# Check if price already exists
					existing_price = frappe.db.exists("Item Price", {
						"item_code": item_code,
						"price_list": price_list,
						"selling": 1
					})
					
					if not existing_price:
						price_doc = frappe.get_doc({
							"doctype": "Item Price",
							"item_code": item_code,
							"price_list": price_list,
							"price_list_rate": selling_price,
							"selling": 1,
							"buying": 0,
							"uom": stock_uom,
						})
						price_doc.insert(ignore_permissions=True)
			except Exception as price_err:
				frappe.log_error(frappe.get_traceback(), f"Error creating selling item price for {item_code}")
		
		# Create Item Price for buying
		if buying_price and buying_price > 0:
			try:
				# Get default buying price list
				buying_price_list = frappe.db.get_single_value("Buying Settings", "buying_price_list")
				if not buying_price_list:
					buying_price_list = frappe.db.get_value("Price List", {"buying": 1, "enabled": 1}, "name")
				
				if buying_price_list:
					# Check if buying price already exists
					existing_buying_price = frappe.db.exists("Item Price", {
						"item_code": item_code,
						"price_list": buying_price_list,
						"buying": 1
					})
					
					if not existing_buying_price:
						buying_price_doc = frappe.get_doc({
							"doctype": "Item Price",
							"item_code": item_code,
							"price_list": buying_price_list,
							"price_list_rate": buying_price,
							"selling": 0,
							"buying": 1,
							"uom": stock_uom,
						})
						buying_price_doc.insert(ignore_permissions=True)
			except Exception as price_err:
				frappe.log_error(frappe.get_traceback(), f"Error creating buying item price for {item_code}")
		
		# Create opening stock if specified
		if opening_stock and opening_stock > 0:
			try:
				_create_opening_stock_entry(
					item_code=item_code,
					qty=opening_stock,
					rate=buying_price or 0,
					company=company,
					batch_no=batch_no,
					expiry_date=expiry_date,
					has_batch_no=has_batch_no
				)
			except Exception as stock_err:
				frappe.log_error(frappe.get_traceback(), f"Error creating opening stock for {item_code}")
		
		frappe.db.commit()
		
		return {
			"success": True,
			"item_code": item_code,
			"item_name": item_name,
			"barcode": barcode,
			"message": _("Item created successfully")
		}
		
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"Error creating item: {item_name}")
		frappe.throw(_("Error creating item: {0}").format(str(e)))


def _create_opening_stock_entry(
	item_code: str,
	qty: float,
	rate: float,
	company: str,
	batch_no: str | None = None,
	expiry_date: str | None = None,
	has_batch_no: int = 0
):
	"""Create a Material Receipt stock entry for opening stock."""
	try:
		# Get default warehouse
		warehouse = None
		
		# Try to get from POS Profile first
		try:
			pos_doc = get_current_pos_profile()
			warehouse = pos_doc.warehouse
		except Exception:
			pass
		
		if not warehouse:
			warehouse = frappe.db.get_value("Company", company, "default_warehouse")
		
		if not warehouse:
			# Get any warehouse
			warehouse = frappe.db.get_value("Warehouse", {"company": company, "is_group": 0}, "name")
		
		if not warehouse:
			frappe.throw(_("No warehouse found for opening stock"))
		
		# Create batch if needed
		created_batch_no = None
		if has_batch_no and batch_no:
			# Check if batch exists
			if not frappe.db.exists("Batch", batch_no):
				batch_doc = frappe.get_doc({
					"doctype": "Batch",
					"batch_id": batch_no,
					"item": item_code,
					"expiry_date": expiry_date if expiry_date else None
				})
				batch_doc.insert(ignore_permissions=True)
			created_batch_no = batch_no
		elif has_batch_no:
			# Auto-generate batch
			batch_id = f"BATCH-{item_code[:10]}-{frappe.generate_hash(length=6).upper()}"
			batch_doc = frappe.get_doc({
				"doctype": "Batch",
				"batch_id": batch_id,
				"item": item_code,
				"expiry_date": expiry_date if expiry_date else None
			})
			batch_doc.insert(ignore_permissions=True)
			created_batch_no = batch_doc.name
		
		# Create Stock Entry
		stock_entry = frappe.get_doc({
			"doctype": "Stock Entry",
			"stock_entry_type": "Material Receipt",
			"company": company,
			"items": [{
				"item_code": item_code,
				"qty": qty,
				"basic_rate": rate,
				"t_warehouse": warehouse,
				"batch_no": created_batch_no if has_batch_no else None
			}]
		})
		
		stock_entry.insert(ignore_permissions=True)
		stock_entry.submit()
		
		return {
			"success": True,
			"stock_entry": stock_entry.name,
			"batch_no": created_batch_no
		}
		
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"Error creating opening stock for {item_code}")
		raise e


@frappe.whitelist()
def create_opening_stock(
	item_code: str,
	qty: float,
	rate: float = 0,
	batch_no: str | None = None,
	expiry_date: str | None = None
):
	"""
	Create opening stock for an existing item.
	
	Args:
		item_code: Item code
		qty: Quantity to add
		rate: Valuation rate
		batch_no: Batch number (optional)
		expiry_date: Expiry date for batch (optional)
	"""
	try:
		if not frappe.db.exists("Item", item_code):
			frappe.throw(_("Item '{0}' not found").format(item_code))
		
		item_doc = frappe.get_doc("Item", item_code)
		company = frappe.defaults.get_user_default("Company") or frappe.db.get_single_value(
			"Global Defaults", "default_company"
		)
		
		result = _create_opening_stock_entry(
			item_code=item_code,
			qty=float(qty),
			rate=float(rate) if rate else 0,
			company=company,
			batch_no=batch_no,
			expiry_date=expiry_date,
			has_batch_no=item_doc.has_batch_no
		)
		
		frappe.db.commit()
		
		return {
			"success": True,
			"message": _("Opening stock created successfully"),
			**result
		}
		
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"Error creating opening stock for {item_code}")
		frappe.throw(_("Error creating opening stock: {0}").format(str(e)))


@frappe.whitelist(allow_guest=True)
def check_barcode_exists(barcode: str):
	"""Check if a barcode already exists."""
	try:
		if not barcode or not barcode.strip():
			return {"exists": False}
		
		exists = frappe.db.exists("Item Barcode", {"barcode": barcode.strip()})
		
		if exists:
			# Get the item code that has this barcode
			item_code = frappe.db.get_value("Item Barcode", {"barcode": barcode.strip()}, "parent")
			return {
				"exists": True,
				"item_code": item_code
			}
		
		return {"exists": False}
		
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"Error checking barcode: {barcode}")
		return {"exists": False, "error": str(e)}


@frappe.whitelist()
def update_item_barcode(item_code: str, barcode: str | None = None):
	"""
	Update or add barcode for an item.
	
	Args:
		item_code: Item code
		barcode: New barcode value (empty string to clear)
	"""
	try:
		if not frappe.db.exists("Item", item_code):
			frappe.throw(_("Item '{0}' not found").format(item_code))
		
		item_doc = frappe.get_doc("Item", item_code)
		
		# Clear existing barcodes
		item_doc.barcodes = []
		
		# Add new barcode if provided
		if barcode and barcode.strip():
			# Check if barcode is already used by another item
			existing = frappe.db.sql("""
				SELECT parent FROM `tabItem Barcode` 
				WHERE barcode = %s AND parent != %s
			""", (barcode.strip(), item_code), as_dict=True)
			
			if existing:
				frappe.throw(_("Barcode '{0}' is already assigned to item '{1}'").format(
					barcode, existing[0].parent
				))
			
			barcode_value = barcode.strip()
			barcode_type = _detect_barcode_type(barcode_value)
			barcode_entry = {"barcode": barcode_value}
			if barcode_type:
				barcode_entry["barcode_type"] = barcode_type
			item_doc.append("barcodes", barcode_entry)
		
		item_doc.save(ignore_permissions=True)
		frappe.db.commit()
		
		return {
			"success": True,
			"message": _("Barcode updated successfully")
		}
		
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"Error updating barcode for {item_code}")
		frappe.throw(_("Error updating barcode: {0}").format(str(e)))


@frappe.whitelist()
def update_item_image(item_code: str, image_data: str | None = None):
	"""
	Update item image.
	
	Args:
		item_code: Item code
		image_data: Base64 encoded image data (data:image/jpeg;base64,...)
	"""
	try:
		if not frappe.db.exists("Item", item_code):
			frappe.throw(_("Item '{0}' not found").format(item_code))
		
		item_doc = frappe.get_doc("Item", item_code)
		
		if image_data and image_data.strip():
			# Save the image
			image_url = _save_item_image(item_code, item_doc.item_name, image_data)
			if image_url:
				item_doc.image = image_url
				item_doc.save(ignore_permissions=True)
				frappe.db.commit()
				
				return {
					"success": True,
					"message": _("Image updated successfully"),
					"image_url": image_url
				}
			else:
				frappe.throw(_("Failed to save image"))
		else:
			# Clear image
			item_doc.image = None
			item_doc.save(ignore_permissions=True)
			frappe.db.commit()
			
			return {
				"success": True,
				"message": _("Image removed")
			}
		
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"Error updating image for {item_code}")
		frappe.throw(_("Error updating image: {0}").format(str(e)))


@frappe.whitelist()
def update_item_prices(
	item_code: str,
	selling_price: float | None = None,
	buying_price: float | None = None,
	price_list: str | None = None,
	buying_price_list: str | None = None
):
	"""
	Update Item Price entries for selling and/or buying prices.
	Creates new entries if they don't exist.
	
	Args:
		item_code: Item code
		selling_price: Selling price to update (optional)
		buying_price: Buying price to update (optional)
		price_list: Selling price list (optional, will use default if not provided)
		buying_price_list: Buying price list (optional, will use default if not provided)
	"""
	try:
		if not frappe.db.exists("Item", item_code):
			frappe.throw(_("Item '{0}' not found").format(item_code))
		
		item_doc = frappe.get_doc("Item", item_code)
		stock_uom = item_doc.stock_uom or "Nos"
		
		updated = []
		
		# Update selling price
		if selling_price is not None and selling_price >= 0:
			# Get default selling price list if not provided
			if not price_list:
				price_list = frappe.db.get_single_value("Selling Settings", "selling_price_list")
				if not price_list:
					price_list = frappe.db.get_value("Price List", {"selling": 1, "enabled": 1}, "name")
			
			if price_list:
				# Check if Item Price entry exists
				existing_price = frappe.db.get_value(
					"Item Price",
					{
						"item_code": item_code,
						"price_list": price_list,
						"selling": 1,
						"uom": stock_uom
					},
					"name"
				)
				
				if existing_price:
					# Update existing entry
					price_doc = frappe.get_doc("Item Price", existing_price)
					price_doc.price_list_rate = selling_price
					price_doc.save(ignore_permissions=True)
					updated.append("selling")
				else:
					# Create new entry
					price_doc = frappe.get_doc({
						"doctype": "Item Price",
						"item_code": item_code,
						"price_list": price_list,
						"price_list_rate": selling_price,
						"selling": 1,
						"buying": 0,
						"uom": stock_uom,
					})
					price_doc.insert(ignore_permissions=True)
					updated.append("selling")
		
		# Update buying price
		if buying_price is not None and buying_price >= 0:
			# Get default buying price list if not provided
			if not buying_price_list:
				buying_price_list = frappe.db.get_single_value("Buying Settings", "buying_price_list")
				if not buying_price_list:
					buying_price_list = frappe.db.get_value("Price List", {"buying": 1, "enabled": 1}, "name")
			
			if buying_price_list:
				# Check if Item Price entry exists
				existing_buying_price = frappe.db.get_value(
					"Item Price",
					{
						"item_code": item_code,
						"price_list": buying_price_list,
						"buying": 1,
						"uom": stock_uom
					},
					"name"
				)
				
				if existing_buying_price:
					# Update existing entry
					buying_price_doc = frappe.get_doc("Item Price", existing_buying_price)
					buying_price_doc.price_list_rate = buying_price
					buying_price_doc.save(ignore_permissions=True)
					updated.append("buying")
				else:
					# Create new entry
					buying_price_doc = frappe.get_doc({
						"doctype": "Item Price",
						"item_code": item_code,
						"price_list": buying_price_list,
						"price_list_rate": buying_price,
						"selling": 0,
						"buying": 1,
						"uom": stock_uom,
					})
					buying_price_doc.insert(ignore_permissions=True)
					updated.append("buying")
		
		frappe.db.commit()
		
		return {
			"success": True,
			"message": _("Prices updated successfully"),
			"updated": updated
		}
		
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"Error updating prices for {item_code}")
		frappe.throw(_("Error updating prices: {0}").format(str(e)))


@frappe.whitelist()
def update_item_prices_with_validity(
	item_code: str,
	new_purchase_price: float | None = None,
	new_selling_price: float | None = None,
	original_purchase_price: float | None = None,
	original_selling_price: float | None = None,
	uom: str | None = None,
):
	"""
	Update Item Prices with valid_from/valid_upto dates for price history tracking.
	
	When a price changes:
	1. Set valid_upto on the existing price entry to now - 1 second
	2. Create a new price entry with valid_from = now
	
	If no existing price entry, create a new one with valid_from = now.
	
	This is typically used during purchase invoice creation when prices change.
	
	Args:
		item_code: Item code
		new_purchase_price: New buying/purchase price
		new_selling_price: New selling price
		original_purchase_price: Original buying price (for comparison)
		original_selling_price: Original selling price (for comparison)
		uom: Unit of measure (defaults to stock UOM)
	
	Returns:
		dict with item_code, buying_updated, selling_updated flags
	"""
	from datetime import datetime, timedelta
	from frappe.utils import flt
	
	try:
		results = {"item_code": item_code, "buying_updated": False, "selling_updated": False}
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

		# Update buying price if changed
		if new_purchase_price is not None and (
			original_purchase_price is None or 
			flt(new_purchase_price) != flt(original_purchase_price)
		):
			if buying_price_list:
				_update_price_entry_with_validity(
					item_code=item_code,
					price_list=buying_price_list,
					new_price=new_purchase_price,
					is_buying=True,
					uom=uom,
					now=now,
				)
				results["buying_updated"] = True

		# Update selling price if changed
		if new_selling_price is not None and (
			original_selling_price is None or 
			flt(new_selling_price) != flt(original_selling_price)
		):
			if selling_price_list:
				_update_price_entry_with_validity(
					item_code=item_code,
					price_list=selling_price_list,
					new_price=new_selling_price,
					is_buying=False,
					uom=uom,
					now=now,
				)
				results["selling_updated"] = True

		frappe.db.commit()
		return results

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"Error updating prices with validity for {item_code}")
		return {"item_code": item_code, "error": str(e)}


def _update_price_entry_with_validity(item_code, price_list, new_price, is_buying, uom, now):
	"""
	Internal helper to update or create an Item Price with validity dates.
	
	Args:
		item_code: Item code
		price_list: Price list name
		new_price: New price value
		is_buying: True for buying price, False for selling
		uom: Unit of measure
		now: Current datetime
	"""
	from datetime import timedelta
	from frappe.utils import flt
	
	# Find existing active price entry
	filters = {
		"item_code": item_code,
		"price_list": price_list,
		"buying": 1 if is_buying else 0,
		"selling": 0 if is_buying else 1,
		"uom": uom,
	}

	# Find the most recent valid price entry
	existing_prices = frappe.get_all(
		"Item Price",
		filters=filters,
		fields=["name", "price_list_rate", "valid_from", "valid_upto"],
		order_by="valid_from desc, creation desc",
		limit=1,
	)

	if existing_prices:
		existing = existing_prices[0]
		
		# Check if price actually changed
		if flt(existing.price_list_rate) == flt(new_price):
			return  # No change needed
		
		# End the existing price validity
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
		"valid_from": now.date(),
	})
	new_price_doc.insert(ignore_permissions=True)


@frappe.whitelist()
def get_item_prices(item_code: str):
	"""
	Get selling and buying prices from Item Price table for an item.
	Returns the prices that are actually used by POS and ItemsPage.
	
	Args:
		item_code: Item code
		
	Returns:
		dict with selling_price, buying_price, and price_lists used
	"""
	try:
		if not frappe.db.exists("Item", item_code):
			frappe.throw(_("Item '{0}' not found").format(item_code))
		
		item_doc = frappe.get_doc("Item", item_code)
		stock_uom = item_doc.stock_uom or "Nos"
		
		# Get default price lists
		selling_price_list = frappe.db.get_single_value("Selling Settings", "selling_price_list")
		if not selling_price_list:
			selling_price_list = frappe.db.get_value("Price List", {"selling": 1, "enabled": 1}, "name")
		
		buying_price_list = frappe.db.get_single_value("Buying Settings", "buying_price_list")
		if not buying_price_list:
			buying_price_list = frappe.db.get_value("Price List", {"buying": 1, "enabled": 1}, "name")
		
		# Fetch selling price
		selling_price = 0
		if selling_price_list:
			selling_price_doc = frappe.db.get_value(
				"Item Price",
				{
					"item_code": item_code,
					"price_list": selling_price_list,
					"selling": 1,
					"uom": stock_uom
				},
				"price_list_rate",
				as_dict=True
			)
			if selling_price_doc:
				selling_price = selling_price_doc.price_list_rate or 0
			else:
				# Try without UOM filter
				selling_price_doc = frappe.db.get_value(
					"Item Price",
					{
						"item_code": item_code,
						"price_list": selling_price_list,
						"selling": 1
					},
					"price_list_rate",
					as_dict=True,
					order_by="modified desc"
				)
				if selling_price_doc:
					selling_price = selling_price_doc.price_list_rate or 0
		
		# Fetch buying price
		buying_price = 0
		if buying_price_list:
			buying_price_doc = frappe.db.get_value(
				"Item Price",
				{
					"item_code": item_code,
					"price_list": buying_price_list,
					"buying": 1,
					"uom": stock_uom
				},
				"price_list_rate",
				as_dict=True
			)
			if buying_price_doc:
				buying_price = buying_price_doc.price_list_rate or 0
			else:
				# Try without UOM filter
				buying_price_doc = frappe.db.get_value(
					"Item Price",
					{
						"item_code": item_code,
						"price_list": buying_price_list,
						"buying": 1
					},
					"price_list_rate",
					as_dict=True,
					order_by="modified desc"
				)
				if buying_price_doc:
					buying_price = buying_price_doc.price_list_rate or 0
		
		# Fallback to Item document fields if no Item Price entries found
		if selling_price == 0:
			selling_price = item_doc.standard_rate or 0
		if buying_price == 0:
			buying_price = item_doc.valuation_rate or 0
		
		return {
			"selling_price": selling_price,
			"buying_price": buying_price,
			"selling_price_list": selling_price_list,
			"buying_price_list": buying_price_list
		}
		
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"Error fetching prices for {item_code}")
		frappe.throw(_("Error fetching prices: {0}").format(str(e)))


@frappe.whitelist()
def update_opening_stock(
	item_code: str,
	warehouse: str,
	qty: float,
	batch_no: str | None = None,
	valuation_rate: float = 0,
	posting_date: str | None = None,
	remarks: str = ""
):
	"""
	Update stock quantity for an existing item via Stock Reconciliation.

	Used when editing qty from the Item Detail page (post-creation).
	Opening stock is only set during item creation via Material Receipt;
	subsequent adjustments go through Stock Reconciliation purpose.

	For batch-tracked items with multiple batches the adjustment is
	distributed: the largest batch is kept/resized to hold the target,
	and smaller batches are zeroed out as needed.
	"""
	from frappe.utils import nowdate, nowtime, flt
	from erpnext.stock.utils import get_stock_balance

	try:
		if not item_code:
			frappe.throw(_("Item Code is required"))
		if not warehouse:
			frappe.throw(_("Warehouse is required"))

		qty = flt(qty)
		if qty < 0:
			frappe.throw(_("Stock quantity cannot be negative"))

		if not frappe.db.exists("Item", item_code):
			frappe.throw(_("Item '{0}' does not exist").format(item_code))
		if not frappe.db.exists("Warehouse", warehouse):
			frappe.throw(_("Warehouse '{0}' does not exist").format(warehouse))

		item = frappe.get_cached_doc("Item", item_code)

		posting_date = posting_date or nowdate()
		posting_time = nowtime()
		valuation_rate = flt(valuation_rate)

		total_current_qty = flt(get_stock_balance(item_code, warehouse, posting_date, posting_time))

		if qty == total_current_qty:
			frappe.throw(
				_("Stock quantity is already {0} for {1} in {2}. No update needed.").format(
					total_current_qty, item_code, warehouse
				)
			)

		company = frappe.db.get_value("Warehouse", warehouse, "company")
		if not company:
			frappe.throw(_("Company not found for warehouse '{0}'").format(warehouse))

		# --- valuation rate ---
		current_valuation_rate = flt(
			frappe.db.get_value("Bin", {"item_code": item_code, "warehouse": warehouse}, "valuation_rate")
		)
		if not valuation_rate:
			valuation_rate = current_valuation_rate

		# --- build reconciliation item rows ---
		item_rows = _build_reconciliation_rows(
			item=item,
			item_code=item_code,
			warehouse=warehouse,
			target_qty=qty,
			total_current_qty=total_current_qty,
			valuation_rate=valuation_rate,
			batch_no=batch_no,
		)

		reconciliation = frappe.get_doc({
			"doctype": "Stock Reconciliation",
			"purpose": "Stock Reconciliation",
			"posting_date": posting_date,
			"posting_time": posting_time,
			"company": company,
			"items": item_rows,
			"remarks": remarks or _("Stock correction from Item Detail page"),
		})

		reconciliation.insert()
		reconciliation.submit()
		frappe.db.commit()

		return {
			"status": "success",
			"reconciliation_name": reconciliation.name,
			"item_code": item_code,
			"warehouse": warehouse,
			"old_qty": total_current_qty,
			"new_qty": qty,
			"difference": qty - total_current_qty,
			"message": _("Stock updated from {0} to {1} for {2} in {3}").format(
				total_current_qty, qty, item_code, warehouse
			),
		}

	except frappe.ValidationError as e:
		frappe.log_error(frappe.get_traceback(), f"Stock reconciliation validation error: {str(e)}")
		frappe.throw(str(e))
	except Exception as e:
		frappe.db.rollback()
		frappe.log_error(frappe.get_traceback(), f"Stock reconciliation error: {str(e)}")
		frappe.throw(_("Failed to update stock: {0}").format(str(e)))


def _build_reconciliation_rows(
	item, item_code, warehouse, target_qty, total_current_qty, valuation_rate, batch_no=None
):
	"""
	Build the list of Stock Reconciliation item rows.

	Non-batch items: single row with the target qty.
	Batch items: distributes target_qty across batches — keeps stock in
	the largest batch (or the specified batch_no) and zeros out the rest
	as needed so the warehouse total equals target_qty.
	"""
	from frappe.utils import flt

	if not item.has_batch_no:
		return [{
			"item_code": item_code,
			"warehouse": warehouse,
			"qty": target_qty,
			"valuation_rate": valuation_rate,
		}]

	# --- batch-tracked item ---
	batches = _get_all_batches_with_stock(item_code, warehouse)

	if not batches:
		# No batches with stock — create a new batch to hold the target qty
		batch_no = batch_no or _create_new_batch(item_code)
		return [{
			"item_code": item_code,
			"warehouse": warehouse,
			"qty": target_qty,
			"valuation_rate": valuation_rate,
			"use_serial_batch_fields": 1,
			"batch_no": batch_no,
		}]

	# Sort batches: largest stock first
	batches.sort(key=lambda b: b["qty"], reverse=True)

	rows = []
	remaining = flt(target_qty)

	for batch in batches:
		bno = batch["batch_no"]
		bqty = flt(batch["qty"])

		if remaining >= bqty:
			# Keep this batch as-is (no change needed, skip it)
			remaining -= bqty
		elif remaining > 0:
			# Partially keep — set this batch to whatever is remaining
			rows.append({
				"item_code": item_code,
				"warehouse": warehouse,
				"qty": remaining,
				"valuation_rate": valuation_rate,
				"use_serial_batch_fields": 1,
				"batch_no": bno,
			})
			remaining = 0
		else:
			# Zero out this batch
			rows.append({
				"item_code": item_code,
				"warehouse": warehouse,
				"qty": 0,
				"valuation_rate": valuation_rate,
				"use_serial_batch_fields": 1,
				"batch_no": bno,
			})

	# If remaining > 0, we need MORE stock than currently exists.
	# Add the extra to the largest batch.
	if remaining > 0:
		largest = batches[0]["batch_no"]
		largest_current = flt(batches[0]["qty"])
		# Check if we already have a row for this batch (we modified it above)
		existing_row = next((r for r in rows if r["batch_no"] == largest), None)
		if existing_row:
			existing_row["qty"] = flt(existing_row["qty"]) + remaining
		else:
			# Largest batch was kept as-is; now we need to increase it
			rows.append({
				"item_code": item_code,
				"warehouse": warehouse,
				"qty": largest_current + remaining,
				"valuation_rate": valuation_rate,
				"use_serial_batch_fields": 1,
				"batch_no": largest,
			})

	if not rows:
		# target_qty equals sum of all batches — shouldn't happen (caught earlier)
		frappe.throw(_("No stock adjustment needed."))

	return rows


def _get_all_batches_with_stock(item_code, warehouse):
	"""Return list of dicts [{batch_no, qty}, ...] for batches with positive stock.

	Uses ERPNext's get_batch_qty which handles both legacy batch_no on SLE
	and the newer Serial and Batch Bundle system.
	"""
	from frappe.utils import flt
	from erpnext.stock.doctype.batch.batch import get_batch_qty

	batches = get_batch_qty(item_code=item_code, warehouse=warehouse) or []

	return [
		{"batch_no": b.get("batch_no"), "qty": flt(b.get("qty"))}
		for b in batches
		if flt(b.get("qty")) > 0
	]


def _create_new_batch(item_code):
	"""Create and return a new batch for the item."""
	batch_id = f"BATCH-{item_code[:10]}-{frappe.generate_hash(length=6).upper()}"
	batch_doc = frappe.get_doc({
		"doctype": "Batch",
		"batch_id": batch_id,
		"item": item_code,
	})
	batch_doc.insert(ignore_permissions=True)
	return batch_doc.name


@frappe.whitelist()
def get_current_stock(item_code: str, warehouse: str, batch_no: str | None = None):
	"""
	Get current stock quantity for an item in a warehouse.
	
	Args:
		item_code: Item code
		warehouse: Warehouse name
		batch_no: Batch number if batch tracking enabled
		
	Returns:
		dict: Current stock information
	"""
	from erpnext.stock.utils import get_stock_balance
	
	try:
		if not item_code or not warehouse:
			frappe.throw(_("Item Code and Warehouse are required"))
		
		current_qty = get_stock_balance(item_code, warehouse)
		
		# Get valuation rate
		bin_name = frappe.db.get_value("Bin", {
			"item_code": item_code,
			"warehouse": warehouse
		})
		
		valuation_rate = 0
		if bin_name:
			bin_doc = frappe.get_doc("Bin", bin_name)
			if bin_doc.actual_qty > 0 and bin_doc.valuation_rate:
				valuation_rate = bin_doc.valuation_rate
		
		# Get batch info if batch tracking
		batch_info = None
		if batch_no:
			batch_info = frappe.db.get_value(
				"Batch",
				batch_no,
				["batch_qty", "expiry_date", "manufacturing_date"],
				as_dict=True
			)
		
		return {
			"item_code": item_code,
			"warehouse": warehouse,
			"current_qty": current_qty,
			"valuation_rate": valuation_rate,
			"batch_no": batch_no,
			"batch_info": batch_info
		}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"Error getting stock: {str(e)}")
		frappe.throw(_("Failed to get stock: {0}").format(str(e)))


@frappe.whitelist()
def get_items_for_export():
	"""
	Get all items with complete details for CSV export.
	
	Returns all active stock items with:
	- item_code
	- item_name
	- barcode
	- selling_price
	- buying_price
	- stock_qty
	- uom (stock_uom)
	- shelf_life_in_days
	- item_group
	- has_batch_no
	- has_expiry_date
	
	Returns:
		dict with items list
	"""
	try:
		# Get POS context for warehouse
		pos_doc, warehouse, price_list, hide_unavailable = _get_pos_context()
		
		# Fetch all active stock items
		items = frappe.get_all(
			"Item",
			filters={
				"disabled": 0,
				"is_stock_item": 1
			},
			fields=[
				"name",
				"item_name",
				"item_group",
				"stock_uom",
				"shelf_life_in_days",
				"has_batch_no",
				"has_expiry_date",
				"valuation_rate",
				"standard_rate"
			],
			order_by="item_name asc",
			limit=0  # No limit - get all items
		)
		
		if not items:
			return {"items": []}
		
		item_codes = [item["name"] for item in items]
		
		# Fetch barcodes in batch
		barcode_map = {}
		try:
			barcode_results = frappe.get_all(
				"Item Barcode",
				filters={"parent": ["in", item_codes]},
				fields=["parent", "barcode"],
				limit=0,
			)
			for barcode_row in barcode_results:
				item_code = barcode_row.get("parent")
				if item_code and item_code not in barcode_map:
					barcode_map[item_code] = barcode_row.get("barcode")
		except Exception:
			frappe.log_error(frappe.get_traceback(), "Error fetching barcodes for export")
		
		# Build UOM map
		uom_map = {item["name"]: item.get("stock_uom", "Nos") for item in items}
		
		# Fetch stock balances in batch
		stock_map = _fetch_batch_stock(item_codes, warehouse) if warehouse else {}
		
		# Fetch prices in batch
		price_map = _fetch_batch_prices(item_codes, price_list, uom_map)
		
		# Build export items
		export_items = []
		for item in items:
			item_code = item["name"]
			
			# Get price info
			price_info = price_map.get(item_code, {})
			selling_price = price_info.get("price", 0) or item.get("standard_rate", 0)
			buying_price = price_info.get("buying_price", 0) or item.get("valuation_rate", 0)
			
			# Get stock qty
			stock_qty = stock_map.get(item_code, 0)
			
			export_items.append({
				"item_code": item_code,
				"item_name": item.get("item_name", item_code),
				"barcode": barcode_map.get(item_code, ""),
				"selling_price": selling_price,
				"buying_price": buying_price,
				"stock_qty": stock_qty,
				"uom": item.get("stock_uom", "Nos"),
				"shelf_life_in_days": item.get("shelf_life_in_days"),
				"item_group": item.get("item_group", "Products"),
				"has_batch_no": item.get("has_batch_no", 0),
				"has_expiry_date": item.get("has_expiry_date", 0)
			})
		
		return {
			"items": export_items,
			"total_count": len(export_items)
		}
		
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Error exporting items")
		frappe.throw(_("Error exporting items: {0}").format(str(e)))


@frappe.whitelist(allow_guest=True)
def get_item_purchase_history(item_code: str, limit: int = 5):
	"""
	Get the last N purchase records for an item, sorted by lowest rate first.
	
	Args:
		item_code: The item code to fetch purchase history for
		limit: Number of records to return (default 5)
	
	Returns:
		dict with:
			- success: bool
			- data: list of purchase records with supplier, rate, datetime
			- message: string (for no purchases case)
	"""
	try:
		if not item_code:
			return {"success": False, "error": "Item code is required"}
		
		# Validate item exists
		if not frappe.db.exists("Item", item_code):
			return {"success": False, "error": f"Item '{item_code}' does not exist"}
		
		# Fetch purchase invoice items for this item
		# Join with Purchase Invoice to get supplier and datetime info
		# Only fetch from submitted invoices (docstatus = 1)
		# Exclude return invoices (is_return = 0)
		query = """
			SELECT 
				pii.rate as purchase_rate,
				pii.qty,
				pi.supplier,
				pi.supplier_name,
				pi.posting_date,
				pi.posting_time,
				pi.name as invoice_name,
				pi.creation as created_at
			FROM `tabPurchase Invoice Item` pii
			INNER JOIN `tabPurchase Invoice` pi ON pii.parent = pi.name
			WHERE pii.item_code = %s
				AND pi.docstatus = 1
				AND pi.is_return = 0
			ORDER BY pii.rate ASC, pi.posting_date DESC, pi.posting_time DESC
			LIMIT %s
		"""
		
		purchases = frappe.db.sql(query, (item_code, int(limit)), as_dict=True)
		
		if not purchases:
			return {
				"success": True,
				"data": [],
				"message": "No purchase history found for this item"
			}
		
		# Format the results
		formatted_purchases = []
		for purchase in purchases:
			# Format posting_time if it's a timedelta
			posting_time_str = ""
			if purchase.get("posting_time"):
				if hasattr(purchase["posting_time"], "total_seconds"):
					total_seconds = int(purchase["posting_time"].total_seconds())
					hours = total_seconds // 3600
					minutes = (total_seconds % 3600) // 60
					posting_time_str = f"{hours:02d}:{minutes:02d}"
				else:
					posting_time_str = str(purchase["posting_time"])[:5]  # HH:MM
			
			formatted_purchases.append({
				"supplier": purchase.get("supplier"),
				"supplier_name": purchase.get("supplier_name"),
				"purchase_rate": float(purchase.get("purchase_rate", 0)),
				"qty": float(purchase.get("qty", 0)),
				"posting_date": str(purchase.get("posting_date")) if purchase.get("posting_date") else "",
				"posting_time": posting_time_str,
				"invoice_name": purchase.get("invoice_name"),
			})
		
		return {
			"success": True,
			"data": formatted_purchases
		}
		
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"Error fetching purchase history for {item_code}")
		return {"success": False, "error": str(e)}


@frappe.whitelist(allow_guest=True)
def get_last_bought_supplier(item_code: str):
	"""Most recent supplier for this item from submitted purchase invoices (by posting date)."""
	try:
		if not item_code:
			return {"success": False, "error": "Item code is required"}
		if not frappe.db.exists("Item", item_code):
			return {"success": False, "error": f"Item '{item_code}' does not exist"}

		row = frappe.db.sql(
			"""
			SELECT pi.supplier, pi.supplier_name
			FROM `tabPurchase Invoice Item` pii
			INNER JOIN `tabPurchase Invoice` pi ON pi.name = pii.parent
			WHERE pii.item_code = %s
				AND pi.docstatus = 1
				AND IFNULL(pi.is_return, 0) = 0
			ORDER BY pi.posting_date DESC, pi.posting_time DESC, pi.creation DESC
			LIMIT 1
			""",
			(item_code,),
			as_dict=True,
		)
		if not row:
			return {"success": True, "data": None, "message": "No purchase history for this item"}
		r = row[0]
		return {
			"success": True,
			"data": {
				"supplier": r.get("supplier"),
				"supplier_name": r.get("supplier_name") or r.get("supplier"),
			},
		}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"get_last_bought_supplier {item_code}")
		return {"success": False, "error": str(e)}


@frappe.whitelist(allow_guest=True)
def get_item_buying_price_history(item_code: str, limit: int = 10):
	"""Buying Item Price rows for timeline (valid_from / valid_upto)."""
	try:
		if not item_code:
			return {"success": False, "error": "Item code is required"}
		if not frappe.db.exists("Item", item_code):
			return {"success": False, "error": f"Item '{item_code}' does not exist"}

		lim = min(int(limit) if limit else 10, 50)
		rows = frappe.db.sql(
			"""
			SELECT price_list, price_list_rate, uom, valid_from, valid_upto, creation
			FROM `tabItem Price`
			WHERE item_code = %s AND IFNULL(buying, 0) = 1
			ORDER BY IFNULL(valid_from, creation) DESC, creation DESC
			LIMIT %s
			""",
			(item_code, lim),
			as_dict=True,
		)
		out = []
		today = frappe.utils.getdate()
		for r in rows:
			vu = r.get("valid_upto")
			is_current = vu is None or (vu and frappe.utils.getdate(vu) >= today)
			out.append(
				{
					"price_list": r.get("price_list"),
					"price_list_rate": float(r.get("price_list_rate") or 0),
					"uom": r.get("uom"),
					"valid_from": str(r.get("valid_from") or "") if r.get("valid_from") else "",
					"valid_upto": str(r.get("valid_upto") or "") if r.get("valid_upto") else "",
					"creation": str(r.get("creation") or ""),
					"is_current": bool(is_current),
				}
			)
		return {"success": True, "data": out}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"get_item_buying_price_history {item_code}")
		return {"success": False, "error": str(e)}


@frappe.whitelist()
def set_item_disabled(item_code: str, disabled: int):
	"""
	Set item disabled status (make inactive/active).
	
	Only Administrator can use this function.
	When disabled=1, item will not appear in Purchase, Sales, or Item list for everyone.
	
	Args:
		item_code: The item code
		disabled: 1 to make inactive, 0 to make active
		
	Returns:
		dict with status and disabled value
	"""
	# Only Administrator can toggle disabled status
	if frappe.session.user != "Administrator":
		frappe.throw(_("Only Administrator can make items inactive/active"), frappe.PermissionError)
	
	try:
		disabled = int(disabled)
		if disabled not in (0, 1):
			frappe.throw(_("disabled must be 0 or 1"))
		
		if not frappe.db.exists("Item", item_code):
			frappe.throw(_("Item {0} not found").format(item_code))
		
		frappe.db.set_value("Item", item_code, "disabled", disabled, update_modified=True)
		frappe.db.commit()
		
		action = "disabled" if disabled == 1 else "enabled"
		frappe.logger().info(f"Item {item_code} {action} by Administrator")
		
		return {
			"status": "success",
			"disabled": disabled,
			"message": f"Item has been {'made inactive' if disabled else 're-enabled'} successfully"
		}
		
	except frappe.PermissionError:
		raise
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"Error setting item disabled for {item_code}")
		return {"status": "error", "message": str(e)}


@frappe.whitelist()
def get_inactive_items(
	limit: int = 500,
	offset: int = 0,
	search: str | None = None,
):
	"""
	Get inactive/disabled items - only accessible by Administrator.
	
	This returns items that have been disabled and won't appear in normal lists.
	
	Args:
		limit: Number of items to return (default 500)
		offset: Starting position for pagination (default 0)
		search: Search term to filter items by name, item_code, or barcode
		
	Returns:
		dict with items, total_count, and has_more flag
	"""
	# Only Administrator can view inactive items
	if frappe.session.user != "Administrator":
		frappe.throw(_("Only Administrator can view inactive items"), frappe.PermissionError)
	
	try:
		limit = int(limit) if limit else 500
		offset = int(offset) if offset else 0
	except (ValueError, TypeError):
		limit = 500
		offset = 0
	
	limit = min(limit, 1000)
	
	pos_doc, warehouse, price_list, _ = _get_pos_context()
	
	try:
		# Build query for disabled items only
		select_fields = "i.name, i.item_name, i.description, i.item_group, i.image, i.stock_uom"
		
		base_query = [
			f"SELECT DISTINCT {select_fields}",
			"FROM `tabItem` i",
			"WHERE i.disabled = 1",  # Only disabled items
			"AND i.is_stock_item = 1",
		]
		count_query = [
			"SELECT COUNT(DISTINCT i.name) as total",
			"FROM `tabItem` i",
			"WHERE i.disabled = 1",
			"AND i.is_stock_item = 1",
		]
		
		params_list: list[object] = []
		count_params: list[object] = []
		
		# Search filter
		if search and search.strip():
			search_term = f"%{search.strip()}%"
			search_condition = """
				AND (
					i.name LIKE %s
					OR i.item_name LIKE %s
					OR i.description LIKE %s
					OR EXISTS (
						SELECT 1 FROM `tabItem Barcode` ib
						WHERE ib.parent = i.name AND ib.barcode LIKE %s
					)
				)
			"""
			base_query.append(search_condition)
			count_query.append(search_condition)
			params_list.extend([search_term, search_term, search_term, search_term])
			count_params.extend([search_term, search_term, search_term, search_term])
		
		# Get total count
		count_sql = "\n".join(count_query)
		total_result = frappe.db.sql(count_sql, tuple(count_params), as_dict=True)
		total_count = total_result[0]["total"] if total_result else 0
		
		# Add ordering and pagination
		base_query.append("ORDER BY i.modified DESC")
		base_query.append("LIMIT %s OFFSET %s")
		params_list.extend([limit, offset])
		
		# Execute query
		items_sql = "\n".join(base_query)
		items_result = frappe.db.sql(items_sql, tuple(params_list), as_dict=True)
		
		# Build response items with prices and stock
		result_items = []
		for item in items_result:
			item_code = item["name"]
			
			# Get barcode
			barcode = frappe.db.get_value(
				"Item Barcode",
				{"parent": item_code},
				"barcode"
			) or ""
			
			# Get stock balance
			balance = 0
			if warehouse:
				try:
					balance = get_stock_balance(item_code, warehouse) or 0
				except Exception:
					balance = 0
			
			# Get prices
			selling_price = 0
			buying_price = 0
			try:
				if price_list:
					selling_price = frappe.db.get_value(
						"Item Price",
						{"item_code": item_code, "price_list": price_list, "selling": 1},
						"price_list_rate"
					) or 0
				buying_price = frappe.db.get_value(
					"Item Price",
					{"item_code": item_code, "buying": 1},
					"price_list_rate",
					order_by="modified desc"
				) or 0
			except Exception:
				pass
			
			result_items.append({
				"id": item_code,
				"name": item["item_name"] or item_code,
				"description": item.get("description") or "",
				"category": item.get("item_group") or "",
				"image": item.get("image") or "",
				"price": float(selling_price),
				"buying_price": float(buying_price),
				"available": float(balance),
				"uom": item.get("stock_uom") or "Nos",
				"barcode": barcode,
				"disabled": 1,
				"currency_symbol": "SAR",
			})
		
		has_more = (offset + len(result_items)) < total_count
		
		return {
			"items": result_items,
			"total_count": total_count,
			"has_more": has_more,
		}
		
	except frappe.PermissionError:
		raise
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Error fetching inactive items")
		return {"items": [], "total_count": 0, "has_more": False, "error": str(e)}
