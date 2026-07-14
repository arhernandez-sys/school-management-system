import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Reset scroll to the top of the page whenever the route pathname changes.
 *
 * The app has no <ScrollRestoration/> and uses nested descendant <Routes> for
 * intra-feature navigation, so a single root-level restorer would miss those
 * transitions. Mounting this hook once in the layout shell covers every route
 * change under it.
 *
 * - Keyed on `pathname` only: query-param changes (pagination/sort) do NOT
 *   scroll to top, so the user keeps their place when paging a list.
 * - Skipped when a `hash` is present so in-page anchors and the `#main-content`
 *   skip link keep working.
 * - Resets both the window and (defensively) the <main id="main-content">
 *   element, in case the main region ever becomes the scroll owner.
 */
export function useScrollToTop(): void {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash) return;

    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });

    const main = document.getElementById('main-content');
    if (main) main.scrollTop = 0;
  }, [pathname, hash]);
}
