// Measure the painted footer instead of an offscreen content-visibility placeholder.
async function prepareA11yPage(page) {
  await page.locator('footer').scrollIntoViewIfNeeded();
  await page.evaluate(async () => {
    // Scroll observers can start finite transitions on the floating controls.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all([...document.querySelectorAll('#hs-toc-float, #hs-font-sizer')]
      .flatMap(element => element.getAnimations())
      .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {})));
  });
}
module.exports = { prepareA11yPage };
