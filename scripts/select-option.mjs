/** Pick an actual rendered option rather than changing a hidden form select.
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} trigger
 * @param {string} value
 */
export async function selectOption(page, trigger, value) {
  await trigger.click();
  await page
    .getByRole("listbox")
    .locator('[role="option"][data-value=' + JSON.stringify(value) + "]")
    .click();
}
