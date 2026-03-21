# Copyright (c) 2025, Klik POS and contributors
# After install: create Date Wise Inventory Manager role if not exists.

import frappe


def after_install():
	from klik_pos.api.date_wise_inventory import DATE_WISE_INVENTORY_ROLE

	if not frappe.db.exists("Role", DATE_WISE_INVENTORY_ROLE):
		frappe.get_doc(
			{
				"doctype": "Role",
				"role_name": DATE_WISE_INVENTORY_ROLE,
				"desk_access": 1,
			}
		).insert(ignore_permissions=True)
		frappe.db.commit()
