import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/_index.tsx"),
  route("new", "routes/new.tsx"),
  route("join", "routes/join.tsx"),

  // Session-scoped routes are added in the next step.

  route("dev/styleguide", "routes/dev.styleguide.tsx"),
] satisfies RouteConfig;
