// apps/docs/tests/playground.spec.ts
//
// <playground-embed> is a top-level light-DOM element that renders its own
// chrome in ITS OWN shadow root (attachShadow in playground-embed.ts) and is
// registered lazily from playground.aihu's onMount — see that file's
// COMPILER WORKAROUND / SCR-R0010 comments for why. Unlike apps/docs (which
// nests the embed inside a <docs-shell> shadow root too), this is a single
// shadow pierce. This smoke test mirrors the manual CDN verification done for
// the perf/a11y pass: the island upgrades, the WASM compiler boots with no
// error banner, and zero console errors are logged.
import { expect, test } from '@playwright/test'

async function waitForEmbed(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => document.querySelector('playground-embed')?.shadowRoot != null, {
    timeout: 10_000,
  })
}

test('playground-embed upgrades and boots with no error banner or console errors', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })

  const res = await page.goto('/playground')
  expect(res?.status()).toBe(200)
  await waitForEmbed(page)
  await page.waitForTimeout(900) // WASM boot + first compile

  const bootError = await page.evaluate(() => {
    const err = document
      .querySelector('playground-embed')
      ?.shadowRoot?.querySelector('.error') as HTMLElement | null
    return err && !err.hidden ? err.textContent : null
  })

  // dist/wasm is staged from the version-pinned release at prebuild. It can be
  // absent only when local dependencies were not installed successfully.
  test.skip(
    bootError?.includes('WASM bundle unavailable') ?? false,
    'no ./wasm bundle in this build',
  )

  expect(bootError).toBeNull()
  expect(errors).toEqual([])
})

test('preset deep link (?preset=) loads that preset on cold visit', async ({ page }) => {
  await page.goto('/playground?preset=aihu-counter')
  await waitForEmbed(page)
  const active = await page.evaluate(() => {
    const sr = document.querySelector('playground-embed')?.shadowRoot
    return (
      sr?.querySelector('.preset-tab[aria-pressed="true"]')?.getAttribute('data-preset-id') ?? null
    )
  })
  expect(active).toBe('aihu-counter')
})
