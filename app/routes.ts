import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("dev/styleguide", "routes/dev.styleguide.tsx"),
] satisfies RouteConfig;
