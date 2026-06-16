// Cross-component signal for the analytics settings panel. The panel renders in
// the root layout, but its entry point lives in the overflow ("⋯") menu in the
// page header — this small rune store lets the menu open it without threading a
// callback up through the page tree.
let open = $state(false);

export const analyticsPanel = {
	get open() {
		return open;
	},
	openPanel() {
		open = true;
	},
	close() {
		open = false;
	}
};
