-- My Sales Book organization upgrade: per-account business profile and stock adjustment history.
-- Additive migration only; existing products, sales, and expenses are preserved.
CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name text NOT NULL DEFAULT '',
  business_logo text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_profiles_business_name_length CHECK (char_length(business_name) <= 100),
  CONSTRAINT user_profiles_logo_size CHECK (business_logo IS NULL OR char_length(business_logo) <= 180000)
);
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own profile" ON public.user_profiles;
CREATE POLICY "Users can view their own profile" ON public.user_profiles FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can create their own profile" ON public.user_profiles;
CREATE POLICY "Users can create their own profile" ON public.user_profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update their own profile" ON public.user_profiles;
CREATE POLICY "Users can update their own profile" ON public.user_profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete their own profile" ON public.user_profiles;
CREATE POLICY "Users can delete their own profile" ON public.user_profiles FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TABLE IF NOT EXISTS public.stock_adjustments (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  product_name text NOT NULL,
  previous_stock integer NOT NULL CHECK (previous_stock >= 0),
  new_stock integer NOT NULL CHECK (new_stock >= 0),
  quantity_change integer NOT NULL,
  reason text NOT NULL DEFAULT '',
  adjusted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_adjustments_user_adjusted_at_idx ON public.stock_adjustments (user_id, adjusted_at DESC);
ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own stock adjustments" ON public.stock_adjustments;
CREATE POLICY "Users can view their own stock adjustments" ON public.stock_adjustments FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can create their own stock adjustments" ON public.stock_adjustments;
CREATE POLICY "Users can create their own stock adjustments" ON public.stock_adjustments FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update their own stock adjustments" ON public.stock_adjustments;
CREATE POLICY "Users can update their own stock adjustments" ON public.stock_adjustments FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete their own stock adjustments" ON public.stock_adjustments;
CREATE POLICY "Users can delete their own stock adjustments" ON public.stock_adjustments FOR DELETE TO authenticated USING (auth.uid() = user_id);
