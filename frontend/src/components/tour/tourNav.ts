import type { TourRun } from './useTourScript';

// How a person gets to another page, shown the way their own device does it:
// on a phone the ☰ menu at the top right and then the page, on a laptop the
// tab along the top. This is the "where is it?" the first mockup never showed.
export async function goToPage(
  t: TourRun,
  o: { phone: boolean; page: string; setMenu: (open: boolean) => void; setPage: (page: string) => void },
) {
  if (o.phone) {
    await t.tap(t.find('[data-tt="menu"]'), { press: true });
    o.setMenu(true);
    await t.wait(700);
    await t.tap(t.find(`[data-tt="menu-${o.page}"]`), { press: true });
    o.setMenu(false);
  } else {
    await t.tap(t.find(`[data-tt="nav-${o.page}"]`), { press: true });
  }
  o.setPage(o.page);
  await t.wait(600);
}
