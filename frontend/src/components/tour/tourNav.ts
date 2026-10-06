import type { TourRun } from './useTourScript';

// The words on the app's own tabs and menu rows (AppHeader, AppMenu), which is how the
// finger finds them: the app's components carry no tour hooks.
const PAGE_LABEL: Record<string, string> = { setup: 'Setup', connect: 'Kiosk', contacts: 'Contacts', export: 'Export', admin: 'Admin' };

// How a person gets to another page, shown the way their own device does it:
// on a phone the ☰ menu at the top right and then the page, on a laptop the
// tab along the top. This is the "where is it?" the first mockup never showed.
export async function goToPage(
  t: TourRun,
  o: { phone: boolean; page: string; setMenu: (open: boolean) => void; setPage: (page: string) => void },
) {
  if (o.phone) {
    await t.tap(t.find('[aria-label="Open menu"]'), { press: true });
    o.setMenu(true);
    await t.wait(700);
    await t.tap(t.findText(PAGE_LABEL[o.page] ?? o.page, '.menu-drawer .q-item__section'), { press: true });
    o.setMenu(false);
  } else {
    await t.tap(t.findText(PAGE_LABEL[o.page] ?? o.page, '.q-tab__label'), { press: true });
  }
  o.setPage(o.page);
  await t.wait(600);
}
