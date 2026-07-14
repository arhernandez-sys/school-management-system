import { CalendarPage } from './CalendarPage';

/**
 * Calendar feature module. Mounted at `${ROUTES.calendar}/*` (app/router/routes.tsx).
 * A single school-wide events page — no nested routes yet — so it simply renders the
 * calendar. Every role reads it; principal/secretary manage events (server-enforced).
 */
export { CalendarPage };
export default CalendarPage;
