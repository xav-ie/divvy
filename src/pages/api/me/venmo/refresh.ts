import { route } from "../../../../api/http.ts";
import { refreshVenmoPhoto } from "../../../../services/venmoProfile.ts";

/** Look the saved Venmo username up again (e.g. after changing the photo on Venmo). */
export const POST = route(({ ctx }) => refreshVenmoPhoto(ctx));
