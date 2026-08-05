import AppLayout from "./layout/components/app-layout";

// This layout is prerendered into every /projects/* route shell, so it must
// not read feature flags directly — that would bake the build machine's env
// into the shell. AppLayout resolves them at request time via getAppFlags().
export default function Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <AppLayout>{children}</AppLayout>;
}
