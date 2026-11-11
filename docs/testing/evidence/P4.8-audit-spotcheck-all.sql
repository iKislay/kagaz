with ev as (
  select e.*, lag(e.to_status) over (partition by order_id order by created_at, id) prev,
         row_number() over (partition by order_id order by created_at, id) rn,
         row_number() over (partition by order_id order by created_at desc, id desc) rn_desc
  from order_events e
), human as (
  select ev.order_id,
    exists (select 1 from audit_logs a where a.order_id=ev.order_id and a.actor_type=ev.actor_type
            and a.actor_id is not distinct from ev.actor_id
            and abs(extract(epoch from a.created_at-ev.created_at)) < 1) matched
  from ev where actor_type in ('DEVICE','STAFF','ADMIN')
), per as (
  select o.id, o.status,
    (select bool_and(case when rn=1 then from_status is null and to_status='DRAFT' else from_status=prev end) from ev where ev.order_id=o.id) chain_ok,
    (select to_status from ev where ev.order_id=o.id and rn_desc=1) = o.status last_ok,
    (select count(*) from human h where h.order_id=o.id) human_events,
    (select count(*) from human h where h.order_id=o.id and matched) audited,
    coalesce((select string_agg(p.status::text, ',') from payments p where p.order_id=o.id),'-') payments
  from orders o
)
select status, count(*) orders, bool_and(chain_ok) chain_ok, bool_and(last_ok) last_ok,
  sum(human_events) human_events, sum(audited) audited, string_agg(distinct payments, ' | ') payments
from per group by status order by status;
