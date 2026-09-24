-- Allow HR to grant/revoke roles and maintain staff profiles (departments)
CREATE POLICY "hr insert roles" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'hr'::app_role));

CREATE POLICY "hr delete roles" ON public.user_roles
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'hr'::app_role));

CREATE POLICY "hr update profiles" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'hr'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'hr'::app_role));

GRANT INSERT, DELETE ON public.user_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
