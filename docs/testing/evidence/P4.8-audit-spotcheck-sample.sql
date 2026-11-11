select setseed(0.48);
create temp table sample as
  select id, public_ref, status from (select id, public_ref, status, random() r from orders order by public_ref) x order by r limit 10;
with ev as (
  select e.*, lag(e.to_status) over (partition by order_id order by created_at, id) prev,
         row_number() over (partition by order_id order by created_at, id) rn,
         row_number() over (partition by order_id order by created_at desc, id desc) rn_desc
  from order_events e where order_id in (select id from sample)
), human as (
  select ev.order_id, ev.id,
    exists (select 1 from audit_logs a where a.order_id=ev.order_id and a.actor_type=ev.actor_type
            and a.actor_id is not distinct from ev.actor_id
            and abs(extract(epoch from a.created_at-ev.created_at)) < 1) matched
  from ev where actor_type in ('DEVICE','STAFF','ADMIN')
)
select s.public_ref, s.status,
  (select count(*) from ev where ev.order_id=s.id) events,
  (select bool_and(case when rn=1 then from_status is null and to_status='DRAFT' else from_status=prev end) from ev where ev.order_id=s.id) chain_ok,
  (select to_status from ev where ev.order_id=s.id and rn_desc=1) = s.status last_ok,
  (select count(*) from human h where h.order_id=s.id) human_events,
  (select count(*) from human h where h.order_id=s.id and matched) audited,
  (select count(*) from audit_logs a where a.order_id=s.id) audit_rows,
  (select string_agg(p.status::text, ',') from payments p where p.order_id=s.id) payments
from sample s order by s.public_ref;
