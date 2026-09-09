import { type RouteConfig, index, layout, prefix, route } from "@react-router/dev/routes";

export default [
  index("routes/_index.tsx"),
  route("new", "routes/new.tsx"),
  route("join", "routes/join.tsx"),

  ...prefix("s/:sid", [
    layout("routes/session/layout.tsx", [
      index("routes/session/dashboard.tsx"),
      route("aktivitet", "routes/session/activity.tsx"),
      route("gor-upp", "routes/session/settle.tsx"),
      route("deltagare", "routes/session/participants.tsx"),
      route("admin", "routes/session/admin.tsx"),
      route("utgifter/ny", "routes/session/expense-new.tsx"),
      route("utgifter/:eid", "routes/session/expense-detail.tsx"),
      route("utgifter/:eid/andra", "routes/session/expense-edit.tsx"),
      route("betalningar/ny", "routes/session/payment-new.tsx"),
      route("betalningar/:pid", "routes/session/payment-detail.tsx"),
      route("betalningar/:pid/andra", "routes/session/payment-edit.tsx"),
    ]),
    route("lamna", "routes/session/leave.tsx"),
  ]),

  route("dev/styleguide", "routes/dev.styleguide.tsx"),
] satisfies RouteConfig;
