-- To Dos: the shared task list between the two admin logins.
--   owner (ADMIN_KEY) = Tovah
--   staff (STAFF_KEY) = Jenna
-- Either one writes a to do for the other, with the how to in the body and
-- screenshots attached. The person doing it attaches the results back.
--
-- Run in the Supabase SQL editor (project yjepajzpkcnfkzckkeeb).

create table if not exists todos (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text,                                   -- the how to, plain text
  created_by  text not null default 'owner',          -- owner | staff
  assigned_to text not null default 'staff',          -- owner | staff | both
  status      text not null default 'open',           -- open | doing | done
  due_date    date,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  done_at     timestamptz
);

-- One row per file or link hung on a to do.
--   kind 'brief'  = posted with the ask ("turn these photos into videos")
--   kind 'result' = posted back by whoever did it
create table if not exists todo_attachments (
  id         uuid primary key default gen_random_uuid(),
  todo_id    uuid not null references todos(id) on delete cascade,
  url        text not null,
  caption    text,
  kind       text not null default 'brief',           -- brief | result
  added_by   text not null default 'owner',           -- owner | staff
  created_at timestamptz not null default now()
);

create index if not exists todo_attachments_todo_idx on todo_attachments (todo_id);

-- RLS on with NO policies = service role only. The browser never reads these
-- tables directly; everything goes through /api/admin/todos, which checks the
-- admin key first. Nothing here is ever exposed to the storefront.
alter table todos enable row level security;
alter table todo_attachments enable row level security;

-- First to do: Jenna's own New York sales tax registration, so the store stops
-- running on Tovah's Arizona license.
insert into todos (title, body, created_by, assigned_to, status, sort_order)
select
  'Get your own New York resale certificate (and the Certificate of Authority it needs)',
  $tododoc$Right now every wholesale buy and every bit of sales tax on this store runs through my Arizona TPT license. Once you are registered in New York, you collect and remit your own sales tax, and you buy inventory tax free under your own number instead of mine.

One naming thing first, so you do not go looking for the wrong form. TPT (transaction privilege tax) is the Arizona word for it. New York does not issue a TPT license. In New York there are two separate pieces:

  1. A Certificate of Authority. This is the state registration that lets you collect sales tax. You apply for it.
  2. Form ST-120, the resale certificate. This is NOT filed with the state. You fill it out and hand it to each supplier so they stop charging you sales tax on goods you are going to resell.

You need the Certificate of Authority first, because ST-120 asks for the sales tax number it gives you.


STEP 1. APPLY FOR THE CERTIFICATE OF AUTHORITY

Where: New York Business Express, https://www.businessexpress.ny.gov
Direct application: https://www.businessexpress.ny.gov/cc/Core/startIntake?licenseTypeCode=DTF17&appTypeCode=INITAPP
Background reading: https://www.tax.ny.gov/bus/st/register.htm

  - You need a NY.gov BUSINESS account. If you already have a personal NY.gov account, that one does not work. Create the business one.
  - Apply at least 20 days before you make taxable sales, provide taxable services in New York, or issue or accept any exemption document. That is the state's rule, not mine.
  - No fee is listed on the state's own pages.

Have these ready before you start, because the form asks for all of it:
  - Reason for applying (starting a new business).
  - Legal name, federal EIN, business address, phone, email.
  - Entity type (sole proprietor, LLC, partnership, corporation).
  - The date you begin business for sales tax purposes.
  - Bank account and routing number for the sales tax deposit account.
  - Any license numbers you already hold.
  - For every responsible person: name, title, home address, home phone, Social Security number, ownership and profit percentage, the date the responsibilities started, and the main duties. This is Form DTF-17.1.

After you submit, the state mails the certificate to you. Do not make taxable sales until it arrives, and keep it displayed at your place of business.


STEP 2. FILL OUT FORM ST-120 AND SEND IT TO THE SUPPLIERS

Form (revision 1/26): https://www.tax.ny.gov/pdf/current_forms/st/st120_fill_in.pdf

  - Part 1 is the section for a purchaser registered in New York. You use your Certificate of Authority number here. Part 2 is the section for an out of state purchaser, who uses the registration number from their own state. Fill in the part that matches where you are registered, not both.
  - Check the blanket certificate box so it covers every future order from that vendor, instead of filling in a new one per purchase.
  - Send a signed copy to every supplier we buy from: Fulfill Engine, Printify, Tapstitch, and any blank goods vendor. Each one has a tax exemption upload in their account settings.
  - Keep a copy for yourself. It does not expire on a set date, but it is only good while the Certificate of Authority number on it is current.


STEP 3. KNOW WHAT YOU OWE AFTER THAT

  - New registrants normally start as quarterly filers on Form ST-100. The quarters end May 31, August 31, November 30, and February 28 or 29, and the return is due 20 days later: June 20, September 20, December 20, March 20.
  - If you owe $3,000 or less for the year, you can file annually on ST-101 instead.
  - Clothing and footwear sold for under $110 is exempt from the New York STATE sales tax. Local tax can still apply depending on the county, and selling exempt clothing means you file Schedule H with the return.
  - File even in a quarter with no sales. The minimum late penalty is $50 whether or not you owe anything.


STEP 4. SEND ME BACK (attach to this to do)

  - A screenshot of the Certificate of Authority, or the confirmation page if it has not arrived yet.
  - Your New York sales tax ID number.
  - The filled out ST-120 PDF, so I can swap my Arizona license off the vendor accounts the same day.

If it turns out you are actually operating out of Arizona rather than New York, stop and tell me. The Arizona path is different: a TPT license through AZTaxes.gov plus Form 5000A as the resale certificate, and none of the above applies.$tododoc$,
  'owner',
  'staff',
  'open',
  0
where not exists (select 1 from todos);
