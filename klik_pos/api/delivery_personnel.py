# Copyright (c) 2026, Beveren Sooftware Inc and contributors
# For license information, please see license.txt

import frappe


@frappe.whitelist()
def get_delivery_personnel_list():
	"""Get list of all delivery personnel."""
	try:
		personnel = frappe.get_all(
			"Delivery Personnel",
			fields=["name", "delivery_personnel"],
			order_by="delivery_personnel asc",
		)
		return {"success": True, "data": personnel}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Error fetching delivery personnel")
		return {"success": False, "error": str(e)}
