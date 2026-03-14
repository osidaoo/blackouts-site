alter table orders
add column if not exists customer_name text,
add column if not exists customer_email text;

create index if not exists idx_orders_customer_email on orders (customer_email);
