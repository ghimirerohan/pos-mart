"""
Supplier API for KLiK POS Purchase Module
Provides CRUD operations for suppliers similar to customer.py
"""

import json

import frappe
from frappe import _


@frappe.whitelist(allow_guest=True)
def get_suppliers(limit: int = 100, start: int = 0, search: str = ""):
	"""
	Fetch suppliers with structured primary contact & address details.
	Returns suppliers based on search criteria.
	"""
	try:
		result = []

		# If there's a search term, search across name, supplier_name, contact email/phone
		if search:
			like_param = f"%{search}%"

			try:
				limit_val = int(limit) if limit else 100
			except Exception:
				limit_val = 100
			# Boost limits for search to show more matches
			limit_val = max(limit_val, 500)

			supplier_names = frappe.db.sql(
				"""
				SELECT DISTINCT s.name, s.supplier_name, s.supplier_type, s.supplier_group, s.country
				FROM `tabSupplier` s
				LEFT JOIN `tabDynamic Link` dl ON dl.link_doctype='Supplier' AND dl.link_name=s.name AND dl.parenttype='Contact'
				LEFT JOIN `tabContact` ct ON ct.name = dl.parent
				LEFT JOIN `tabContact Email` ce ON ce.parent = ct.name
				LEFT JOIN `tabContact Phone` cp ON cp.parent = ct.name
				WHERE s.disabled = 0 AND (
					s.supplier_name LIKE %s OR s.name LIKE %s OR
					ce.email_id LIKE %s OR cp.phone LIKE %s
				)
				ORDER BY s.creation DESC
				LIMIT %s OFFSET %s
				""",
				(like_param, like_param, like_param, like_param, limit_val, int(start) or 0),
				as_dict=True,
			)

			# Total count for search
			total_count_row = frappe.db.sql(
				"""
				SELECT COUNT(DISTINCT s.name) as total
				FROM `tabSupplier` s
				LEFT JOIN `tabDynamic Link` dl ON dl.link_doctype='Supplier' AND dl.link_name=s.name AND dl.parenttype='Contact'
				LEFT JOIN `tabContact` ct ON ct.name = dl.parent
				LEFT JOIN `tabContact Email` ce ON ce.parent = ct.name
				LEFT JOIN `tabContact Phone` cp ON cp.parent = ct.name
				WHERE s.disabled = 0 AND (
					s.supplier_name LIKE %s OR s.name LIKE %s OR
					ce.email_id LIKE %s OR cp.phone LIKE %s
				)
				""",
				(like_param, like_param, like_param, like_param),
				as_dict=True,
			)
			total_count = (total_count_row[0].total if total_count_row else 0) or 0
		else:
			# Original logic for when no search term
			filters = {"disabled": 0}

			supplier_names = frappe.get_all(
				"Supplier",
				filters=filters,
				fields=[
					"name",
					"supplier_name",
					"supplier_type",
					"supplier_group",
					"country",
				],
				order_by="creation desc",
				limit=limit,
				start=start,
			)

			total_count = frappe.db.count("Supplier", filters=filters)

		# Process each supplier to get detailed information
		for supp in supplier_names:
			doc = frappe.get_doc("Supplier", supp.name)

			contact = (
				frappe.db.get_value(
					"Contact",
					{"name": doc.supplier_primary_contact},
					["first_name", "last_name", "email_id", "phone", "mobile_no"],
					as_dict=True,
				)
				if doc.supplier_primary_contact
				else None
			)

			address = (
				frappe.db.get_value(
					"Address",
					{"name": doc.supplier_primary_address},
					["address_line1", "city", "state", "country", "pincode"],
					as_dict=True,
				)
				if doc.supplier_primary_address
				else None
			)

			# Get supplier statistics
			stats = get_supplier_statistics(doc.name)
			supplier_stats = stats.get("data", {}) if stats.get("success") else {}

			result.append(
				{
					"id": doc.name,
					"name": doc.name,
					"supplier_name": doc.supplier_name,
					"supplier_type": doc.supplier_type,
					"supplier_group": doc.supplier_group,
					"country": doc.country,
					"contact": contact,
					"address": address,
					"total_orders": supplier_stats.get("total_orders", 0),
					"total_spent": supplier_stats.get("total_spent", 0),
					"last_purchase": supplier_stats.get("last_purchase"),
				}
			)

		return {
			"success": True,
			"data": result,
			"total_count": total_count,
			"start": start,
			"limit": limit,
		}

	except Exception:
		frappe.log_error(frappe.get_traceback(), "Error fetching suppliers")
		return {
			"success": False,
			"error": _("Something went wrong while fetching suppliers."),
		}


@frappe.whitelist(allow_guest=True)
def get_supplier_info(supplier_name: str):
	"""Fetch comprehensive supplier document by supplier name or ID."""
	try:
		import urllib.parse

		supplier_name = urllib.parse.unquote(supplier_name)

		# First try to find by supplier_name
		suppliers = frappe.get_all("Supplier", filters={"supplier_name": supplier_name}, fields=["name"])

		# If not found by supplier_name, try by name (ID)
		if not suppliers:
			suppliers = frappe.get_all("Supplier", filters={"name": supplier_name}, fields=["name"])

		if not suppliers:
			return {"success": False, "error": f"Supplier not found: {supplier_name}"}

		supplier = frappe.get_doc("Supplier", suppliers[0]["name"])

		# Get primary contact details
		contact_data = None
		if supplier.supplier_primary_contact:
			contact_data = frappe.db.get_value(
				"Contact",
				supplier.supplier_primary_contact,
				["first_name", "last_name", "email_id", "phone", "mobile_no"],
				as_dict=True,
			)

		# Get primary address details
		address_data = None
		if supplier.supplier_primary_address:
			address_data = frappe.db.get_value(
				"Address",
				supplier.supplier_primary_address,
				[
					"address_line1",
					"address_line2",
					"city",
					"state",
					"country",
					"pincode",
				],
				as_dict=True,
			)

		supplier_data = {
			"id": supplier.name,
			"name": supplier.name,
			"supplier_name": supplier.supplier_name,
			"supplier_group": supplier.supplier_group,
			"supplier_type": supplier.supplier_type,
			"country": supplier.country,
			"supplier_primary_contact": supplier.supplier_primary_contact,
			"supplier_primary_address": supplier.supplier_primary_address,
			"creation": supplier.creation,
			"contact_data": contact_data,
			"address_data": address_data,
		}

		return {"success": True, "data": supplier_data}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Error fetching supplier info")
		return {"success": False, "error": str(e)}


@frappe.whitelist()
def create_supplier(supplier_data):
	"""Create a new supplier with contact and address."""
	try:
		if isinstance(supplier_data, str):
			supplier_data = frappe.parse_json(supplier_data)

		supplier_name = supplier_data.get("supplier_name") or supplier_data.get("name")
		email = supplier_data.get("email")
		phone = supplier_data.get("phone")
		contact_name = supplier_data.get("contact_name", supplier_name)
		supplier_group = supplier_data.get("supplier_group", "All Supplier Groups")
		supplier_type = supplier_data.get("supplier_type", "Company")
		country = supplier_data.get("country", "Nepal")
		address = supplier_data.get("address", {})

		if not supplier_name:
			frappe.throw(_("Supplier name is required"))

		# Check if supplier already exists
		existing = frappe.get_all("Supplier", filters={"supplier_name": supplier_name}, fields=["name"])
		if existing:
			frappe.throw(_("Supplier with name '{0}' already exists").format(supplier_name))

		# Create supplier
		supplier_doc = frappe.get_doc({
			"doctype": "Supplier",
			"supplier_name": supplier_name,
			"supplier_type": supplier_type,
			"supplier_group": supplier_group,
			"country": country,
		})
		supplier_doc.insert(ignore_permissions=True)

		contact_doc = None
		addr_doc = None

		# Create contact if email or phone provided
		if email or phone:
			contact_doc = _create_supplier_contact(supplier_doc.name, contact_name, email, phone)
			if contact_doc:
				frappe.db.set_value(
					"Supplier",
					supplier_doc.name,
					"supplier_primary_contact",
					contact_doc.name,
				)

		# Create address if address data provided
		if address and any(address.get(field) for field in ["street", "city", "state", "zipCode"]):
			addr_doc = _create_supplier_address(supplier_doc.name, supplier_name, address, country)
			if addr_doc:
				frappe.db.set_value(
					"Supplier",
					supplier_doc.name,
					"supplier_primary_address",
					addr_doc.name,
				)

		frappe.db.commit()

		return {
			"success": True,
			"supplier_name": supplier_doc.name,
			"contact_name": contact_doc.name if contact_doc else None,
			"address_name": addr_doc.name if addr_doc else None,
		}

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Supplier Creation Error")
		return {"success": False, "error": str(e)}


@frappe.whitelist()
def update_supplier(supplier_id, supplier_data):
	"""Update an existing supplier."""
	if isinstance(supplier_data, str):
		supplier_data = json.loads(supplier_data)

	try:
		supplier = frappe.get_doc("Supplier", supplier_id)

		email = supplier_data.get("email")
		phone = supplier_data.get("phone")
		supplier_name = supplier_data.get("supplier_name", supplier.supplier_name)
		contact_name = supplier_data.get("contact_name", supplier_name)
		address_data = supplier_data.get("address", {})
		country = address_data.get("country") or supplier_data.get("country", "Nepal")

		# Update supplier fields
		if supplier_data.get("supplier_name"):
			supplier.supplier_name = supplier_data["supplier_name"]
		if supplier_data.get("supplier_group"):
			supplier.supplier_group = supplier_data["supplier_group"]
		if supplier_data.get("supplier_type"):
			supplier.supplier_type = supplier_data["supplier_type"]
		if supplier_data.get("country"):
			supplier.country = supplier_data["country"]

		supplier.save(ignore_permissions=True)

		# Update or create contact
		if email or phone:
			if supplier.supplier_primary_contact:
				try:
					contact_doc = frappe.get_doc("Contact", supplier.supplier_primary_contact)
					contact_doc.first_name = contact_name

					if email:
						contact_doc.email_ids = []
						contact_doc.append("email_ids", {"email_id": email, "is_primary": 1})

					if phone:
						contact_doc.phone_nos = []
						contact_doc.append(
							"phone_nos",
							{
								"phone": phone,
								"is_primary_mobile_no": 1,
								"is_primary_phone": 1,
							},
						)

					contact_doc.save(ignore_permissions=True)
				except Exception:
					frappe.log_error(
						frappe.get_traceback(),
						f"Error updating contact for supplier {supplier_id}",
					)
			else:
				contact_doc = _create_supplier_contact(supplier_id, contact_name, email, phone)
				if contact_doc:
					frappe.db.set_value(
						"Supplier",
						supplier_id,
						"supplier_primary_contact",
						contact_doc.name,
					)

		# Update address
		if address_data and any(
			address_data.get(field) for field in ["street", "city", "state", "zipCode"]
		):
			try:
				addr_doc = _create_supplier_address(supplier_id, supplier_name, address_data, country)
				if addr_doc:
					frappe.db.set_value(
						"Supplier",
						supplier_id,
						"supplier_primary_address",
						addr_doc.name,
					)
			except Exception:
				frappe.log_error(
					frappe.get_traceback(),
					f"Error updating address for supplier {supplier_id}",
				)

		frappe.db.commit()
		return {"success": True, "updated_supplier": supplier.name}

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Update Supplier Error")
		return {"success": False, "error": str(e)}


@frappe.whitelist(allow_guest=True)
def get_supplier_groups():
	"""Fetch all supplier groups."""
	try:
		supplier_groups = frappe.get_all(
			"Supplier Group",
			fields=["name", "supplier_group_name"],
			order_by="supplier_group_name asc",
		)

		# Check if "All Supplier Groups" already exists, if not add it
		has_all_groups = any(group["name"] == "All Supplier Groups" for group in supplier_groups)
		if not has_all_groups:
			supplier_groups.insert(
				0,
				{
					"name": "All Supplier Groups",
					"supplier_group_name": "All Supplier Groups",
				},
			)

		return {"success": True, "data": supplier_groups}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Error fetching supplier groups")
		return {"success": False, "error": str(e)}


@frappe.whitelist()
def get_supplier_statistics(supplier_id):
	"""Get supplier statistics including total orders and total spent."""
	try:
		# Get total purchase invoices for the supplier
		total_orders = frappe.db.count(
			"Purchase Invoice",
			filters={
				"supplier": supplier_id,
				"docstatus": 1,
				"is_return": 0,
				"status": ["!=", "Cancelled"],
			},
		)

		# Get total amount spent with the supplier
		total_spent_result = frappe.db.sql(
			"""
			SELECT COALESCE(SUM(grand_total), 0) as total_spent
			FROM `tabPurchase Invoice`
			WHERE supplier = %s
			AND docstatus = 1
			AND is_return = 0
			AND status != 'Cancelled'
			""",
			(supplier_id,),
			as_dict=True,
		)

		total_spent = total_spent_result[0].total_spent if total_spent_result else 0

		# Get last purchase date
		last_purchase_result = frappe.db.sql(
			"""
			SELECT MAX(posting_date) as last_purchase
			FROM `tabPurchase Invoice`
			WHERE supplier = %s
			AND docstatus = 1
			AND is_return = 0
			AND status != 'Cancelled'
			""",
			(supplier_id,),
			as_dict=True,
		)

		last_purchase = last_purchase_result[0].last_purchase if last_purchase_result else None

		return {
			"success": True,
			"data": {
				"total_orders": total_orders,
				"total_spent": total_spent,
				"last_purchase": last_purchase,
			},
		}

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Error fetching supplier statistics")
		return {"success": False, "error": str(e)}


def _create_supplier_contact(supplier_id, contact_name, email, phone):
	"""Create a contact for a supplier."""
	try:
		contact_doc = frappe.get_doc({
			"doctype": "Contact",
			"first_name": contact_name,
			"links": [{"link_doctype": "Supplier", "link_name": supplier_id}],
		})

		if email:
			contact_doc.append("email_ids", {"email_id": email, "is_primary": 1})

		if phone:
			contact_doc.append(
				"phone_nos",
				{
					"phone": phone,
					"is_primary_mobile_no": 1,
					"is_primary_phone": 1,
				},
			)

		contact_doc.insert(ignore_permissions=True)
		return contact_doc
	except Exception:
		frappe.log_error(frappe.get_traceback(), f"Error creating contact for supplier {supplier_id}")
		return None


def _create_supplier_address(supplier_id, supplier_name, address_data, country):
	"""Create or update an address for a supplier."""
	if not address_data:
		return None

	address_title = f"{supplier_name} - Primary"

	address_fields = {
		"address_title": address_title,
		"address_type": address_data.get("addressType", "Billing"),
		"address_line1": address_data.get("street", ""),
		"address_line2": address_data.get("buildingNumber", ""),
		"city": address_data.get("city", ""),
		"state": address_data.get("state", ""),
		"pincode": address_data.get("zipCode", ""),
		"country": country,
		"is_primary_address": 1,
		"is_shipping_address": 0,
	}

	existing = frappe.get_all("Address", filters={"address_title": address_title}, fields=["name"])

	if existing:
		doc = frappe.get_doc("Address", existing[0]["name"])
		for field, value in address_fields.items():
			setattr(doc, field, value)
		doc.links = []
	else:
		doc = frappe.new_doc("Address")
		for field, value in address_fields.items():
			setattr(doc, field, value)

	doc.append(
		"links",
		{
			"link_doctype": "Supplier",
			"link_name": supplier_id,
			"link_title": supplier_name,
		},
	)
	doc.save(ignore_permissions=True)
	return doc
