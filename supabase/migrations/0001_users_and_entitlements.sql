-- Mirror Supabase auth.users into public.users so app code has a stable user surface.
-- Also create the entitlements table that RevenueCat webhook will write to.

CREATE TABLE public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    display_name TEXT,
    role_flags TEXT[] NOT NULL DEFAULT ARRAY['athlete']::TEXT[],
    timezone TEXT NOT NULL DEFAULT 'UTC',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT users_role_flags_valid CHECK (
        role_flags <@ ARRAY['athlete', 'coach']::TEXT[]
        AND array_length(role_flags, 1) >= 1
    )
);

CREATE INDEX users_deleted_at_idx ON public.users (deleted_at);

-- Auto-touch updated_at on row updates.
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END $$;

CREATE TRIGGER users_touch_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Mirror new auth.users rows into public.users on signup.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO public.users (id, email)
    VALUES (NEW.id, NEW.email)
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END $$;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- Entitlements: source of truth for paid feature access. Written only by service role
-- (RevenueCat webhook); read by the user themselves.
CREATE TABLE public.entitlements (
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    entitlement_key TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT FALSE,
    source TEXT NOT NULL,
    expires_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, entitlement_key),
    CONSTRAINT entitlements_source_valid CHECK (source IN ('revenuecat'))
);

CREATE INDEX entitlements_user_active_idx ON public.entitlements (user_id) WHERE active;

-- RLS.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entitlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_self_select ON public.users
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY users_self_update ON public.users
    FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE POLICY entitlements_self_select ON public.entitlements
    FOR SELECT USING (auth.uid() = user_id);

-- Note: write to entitlements only via service role (RevenueCat webhook handler).
-- No INSERT/UPDATE policies for anon — RLS denies by default.
