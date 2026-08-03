--
-- PostgreSQL database dump
--

\restrict E4SpaXr6UjulWfFxfMFYW9a5gjhlesMOSM9S9IAFPGmdmPvpjoPUdhLC9HFTJxG

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.10 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: fixed_expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fixed_expenses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_domain text NOT NULL,
    shopify_location_id text,
    location_name text,
    expense_name text NOT NULL,
    expense_category text,
    monthly_amount numeric DEFAULT 0 NOT NULL,
    start_month date NOT NULL,
    end_month date,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inventory_levels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_levels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_domain text NOT NULL,
    shopify_location_id text NOT NULL,
    shopify_variant_id text,
    inventory_item_id text NOT NULL,
    sku text,
    available integer DEFAULT 0,
    tracked boolean DEFAULT true,
    synced_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.locations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_domain text NOT NULL,
    shopify_location_id text NOT NULL,
    name text NOT NULL,
    is_active boolean DEFAULT true,
    city text,
    province text,
    country text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: order_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_domain text NOT NULL,
    shopify_order_id text NOT NULL,
    shopify_line_item_id text NOT NULL,
    order_name text NOT NULL,
    created_at_shopify timestamp with time zone NOT NULL,
    retail_location_id text,
    retail_location_name text,
    shopify_variant_id text,
    inventory_item_id text,
    product_title text,
    variant_title text,
    sku text,
    vendor text,
    quantity integer DEFAULT 0 NOT NULL,
    unit_price numeric DEFAULT 0 NOT NULL,
    revenue numeric DEFAULT 0 NOT NULL,
    unit_cost numeric,
    cogs numeric,
    gross_profit numeric,
    cost_source text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_domain text NOT NULL,
    shopify_order_id text NOT NULL,
    order_name text NOT NULL,
    created_at_shopify timestamp with time zone NOT NULL,
    financial_status text,
    retail_location_id text,
    retail_location_name text,
    total_price numeric,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_domain text NOT NULL,
    shopify_product_id text NOT NULL,
    title text NOT NULL,
    vendor text,
    product_type text,
    status text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: shops; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shops (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_domain text NOT NULL,
    shop_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sync_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_domain text NOT NULL,
    sync_type text NOT NULL,
    status text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    error_message text,
    source text,
    details jsonb
);


--
-- Name: user_location_access; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_location_access (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_domain text NOT NULL,
    user_email text NOT NULL,
    shopify_user_id text,
    shopify_location_id text,
    location_name text,
    role text DEFAULT 'viewer'::text NOT NULL,
    can_view boolean DEFAULT true NOT NULL,
    can_manage boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: variants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.variants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_domain text NOT NULL,
    shopify_variant_id text NOT NULL,
    shopify_product_id text,
    inventory_item_id text,
    title text,
    sku text,
    price numeric,
    unit_cost numeric,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: fixed_expenses fixed_expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fixed_expenses
    ADD CONSTRAINT fixed_expenses_pkey PRIMARY KEY (id);


--
-- Name: inventory_levels inventory_levels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_levels
    ADD CONSTRAINT inventory_levels_pkey PRIMARY KEY (id);


--
-- Name: inventory_levels inventory_levels_shop_domain_shopify_location_id_inventory__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_levels
    ADD CONSTRAINT inventory_levels_shop_domain_shopify_location_id_inventory__key UNIQUE (shop_domain, shopify_location_id, inventory_item_id);


--
-- Name: locations locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_pkey PRIMARY KEY (id);


--
-- Name: locations locations_shop_domain_shopify_location_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_shop_domain_shopify_location_id_key UNIQUE (shop_domain, shopify_location_id);


--
-- Name: order_lines order_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_lines
    ADD CONSTRAINT order_lines_pkey PRIMARY KEY (id);


--
-- Name: order_lines order_lines_shop_domain_shopify_line_item_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_lines
    ADD CONSTRAINT order_lines_shop_domain_shopify_line_item_id_key UNIQUE (shop_domain, shopify_line_item_id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: orders orders_shop_domain_shopify_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_shop_domain_shopify_order_id_key UNIQUE (shop_domain, shopify_order_id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: products products_shop_domain_shopify_product_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_shop_domain_shopify_product_id_key UNIQUE (shop_domain, shopify_product_id);


--
-- Name: shops shops_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shops
    ADD CONSTRAINT shops_pkey PRIMARY KEY (id);


--
-- Name: shops shops_shop_domain_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shops
    ADD CONSTRAINT shops_shop_domain_key UNIQUE (shop_domain);


--
-- Name: sync_runs sync_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_runs
    ADD CONSTRAINT sync_runs_pkey PRIMARY KEY (id);


--
-- Name: user_location_access user_location_access_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_location_access
    ADD CONSTRAINT user_location_access_pkey PRIMARY KEY (id);


--
-- Name: user_location_access user_location_access_shop_domain_user_email_shopify_locatio_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_location_access
    ADD CONSTRAINT user_location_access_shop_domain_user_email_shopify_locatio_key UNIQUE (shop_domain, user_email, shopify_location_id);


--
-- Name: variants variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.variants
    ADD CONSTRAINT variants_pkey PRIMARY KEY (id);


--
-- Name: variants variants_shop_domain_shopify_variant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.variants
    ADD CONSTRAINT variants_shop_domain_shopify_variant_id_key UNIQUE (shop_domain, shopify_variant_id);


--
-- Name: inventory_levels_shop_location_item_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inventory_levels_shop_location_item_uidx ON public.inventory_levels USING btree (shop_domain, shopify_location_id, inventory_item_id);


--
-- Name: locations_shop_location_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX locations_shop_location_uidx ON public.locations USING btree (shop_domain, shopify_location_id);


--
-- Name: order_lines_shop_line_item_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX order_lines_shop_line_item_uidx ON public.order_lines USING btree (shop_domain, shopify_line_item_id);


--
-- Name: orders_shop_order_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX orders_shop_order_uidx ON public.orders USING btree (shop_domain, shopify_order_id);


--
-- Name: products_shop_product_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX products_shop_product_uidx ON public.products USING btree (shop_domain, shopify_product_id);


--
-- Name: user_location_access_shop_user_location_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_location_access_shop_user_location_uidx ON public.user_location_access USING btree (shop_domain, user_email, shopify_location_id);


--
-- Name: variants_shop_variant_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX variants_shop_variant_uidx ON public.variants USING btree (shop_domain, shopify_variant_id);


--
-- PostgreSQL database dump complete
--

\unrestrict E4SpaXr6UjulWfFxfMFYW9a5gjhlesMOSM9S9IAFPGmdmPvpjoPUdhLC9HFTJxG

