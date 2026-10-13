-- =====================================================================
--  اختبار الصلاحيات — الصقه في SQL Editor واضغط Run بعد schema.sql
--  كل البيانات التجريبية تنحذف تلقائياً في النهاية.
--  النتيجة تطلع كرسالة "error" — هذا مقصود (عشان يتراجع عن كل شي).
--  ابحث عن: ALL PASSED  أو  FAILED
-- =====================================================================
do $$
declare
  c1 uuid := gen_random_uuid();  c2 uuid := gen_random_uuid();
  s1 uuid := gen_random_uuid();  s2 uuid := gen_random_uuid();
  u_admin uuid := gen_random_uuid(); u_t1 uuid := gen_random_uuid();
  u_p1 uuid := gen_random_uuid();  u_p2 uuid := gen_random_uuid();
  u_p3 uuid := gen_random_uuid();  u_p4 uuid := gen_random_uuid(); u_x uuid := gen_random_uuid();
  l1 uuid; l2 uuid; l3 uuid; q1 uuid; sub1 uuid;
  inv_code text; code1 text; code2 text;
  n int; r jsonb; v text;
  pass int := 0; fail int := 0; log text := '';
begin
  -- ---------- تجهيز (كـ postgres) ----------
  insert into public.classes (id, name_ar) values (c1, 'TEST-1'), (c2, 'TEST-2');
  insert into public.students (id, full_name, class_id) values (s1, 'Test Kid 1', c1), (s2, 'Test Kid 2', c2);
  select code into code1 from public.student_codes where student_id = s1;
  select code into code2 from public.student_codes where student_id = s2;

  insert into auth.users (id, email, raw_user_meta_data) values (u_admin, 'admin@test.invalid', '{"full_name":"T Admin"}');
  update public.profiles set role = 'admin' where id = u_admin;

  insert into public.teacher_invites (full_name, class_id) values ('T Teacher', c1) returning code into inv_code;
  insert into auth.users (id, email, raw_user_meta_data) values
    (u_t1, 't1@test.invalid', jsonb_build_object('full_name', 'T Teacher', 'invite_code', inv_code)),
    (u_p1, 'p1@test.invalid', jsonb_build_object('full_name', 'Parent 1', 'invite_code', lower(replace(code1, '-', ' ')))),
    (u_p2, 'p2@test.invalid', jsonb_build_object('full_name', 'Parent 2', 'invite_code', code2));

  -- 1
  if (select role from public.profiles where id = u_t1) = 'teacher'
     and exists (select 1 from public.class_teachers where class_id = c1 and teacher_id = u_t1)
  then pass := pass + 1; else fail := fail + 1; log := log || E'\n✗ 1 teacher invite did not set role/class'; end if;

  -- 2 الكود يشتغل حتى لو مكتوب بحروف صغيرة وبدون شرطة
  if exists (select 1 from public.student_guardians where student_id = s1 and parent_id = u_p1)
  then pass := pass + 1; else fail := fail + 1; log := log || E'\n✗ 2 parent code not linked (normalisation)'; end if;

  -- ---------- المدرس ينشئ دروس ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_t1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  l1 := public.save_lesson(jsonb_build_object('class_id', c1, 'title', 'L1', 'has_quiz', true, 'published', true,
          'questions', jsonb_build_array(jsonb_build_object('prompt', '1+1?', 'options', jsonb_build_array('1', '2', '3'), 'correct', 1))));
  l3 := public.save_lesson(jsonb_build_object('class_id', c1, 'title', 'L3 draft', 'has_quiz', false, 'published', false));
  -- 3 المدرس ما يقدر ينشئ درس لفصل غيره
  begin
    perform public.save_lesson(jsonb_build_object('class_id', c2, 'title', 'hack'));
    fail := fail + 1; log := log || E'\n✗ 3 teacher created lesson in another class';
  exception when others then pass := pass + 1; end;
  execute 'reset role';

  select id into q1 from public.questions where lesson_id = l1;

  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  l2 := public.save_lesson(jsonb_build_object('class_id', c2, 'title', 'L2', 'has_quiz', false, 'allow_photo', true, 'published', true));
  execute 'reset role';

  -- ---------- ولي الأمر 1 ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- 4
  select count(*) into n from public.students;
  if n = 1 and exists (select 1 from public.students where id = s1)
  then pass := pass + 1; else fail := fail + 1; log := log || E'\n✗ 4 parent sees other students: ' || n; end if;
  -- 5
  select count(*) into n from public.lessons;
  if n = 1 and exists (select 1 from public.lessons where id = l1)
  then pass := pass + 1; else fail := fail + 1; log := log || E'\n✗ 5 parent sees wrong lessons: ' || n; end if;
  -- 6
  select count(*) into n from public.question_keys;
  if n = 0 then pass := pass + 1; else fail := fail + 1; log := log || E'\n✗ 6 parent can read answer keys'; end if;
  -- 7
  select count(*) into n from public.student_codes;
  if n = 0 then pass := pass + 1; else fail := fail + 1; log := log || E'\n✗ 7 parent can read codes'; end if;
  -- 8
  begin
    update public.profiles set role = 'admin' where id = u_p1;
    fail := fail + 1; log := log || E'\n✗ 8 parent changed own role';
  exception when others then pass := pass + 1; end;
  -- 9
  begin
    insert into public.students (full_name, class_id) values ('x', c1);
    fail := fail + 1; log := log || E'\n✗ 9 parent inserted a student';
  exception when others then pass := pass + 1; end;
  -- 10 حل صحيح
  r := public.submit_quiz(l1, s1, jsonb_build_object(q1::text, 1));
  if (r ->> 'score')::int = 1 and (r ->> 'total')::int = 1
  then pass := pass + 1; else fail := fail + 1; log := log || E'\n✗ 10 grading wrong: ' || r::text; end if;
  -- 11 حل لطالب مو ولده
  begin
    perform public.submit_quiz(l2, s2, '{}'::jsonb);
    fail := fail + 1; log := log || E'\n✗ 11 parent submitted for another child';
  exception when others then pass := pass + 1; end;
  -- 12 تزوير الدرجة
  begin
    update public.submissions set score = 99 where student_id = s1;
    fail := fail + 1; log := log || E'\n✗ 12 parent changed score';
  exception when others then pass := pass + 1; end;
  -- 13 رفع صورة بمسار غلط
  begin
    perform public.attach_photo(l2, s2, s2::text || '/' || l2::text || '/x.jpg');
    fail := fail + 1; log := log || E'\n✗ 13 parent attached photo for another child';
  exception when others then pass := pass + 1; end;
  execute 'reset role';

  -- ---------- ولي الأمر 2 ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_p2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  -- 14
  select count(*) into n from public.submissions;
  if n = 0 then pass := pass + 1; else fail := fail + 1; log := log || E'\n✗ 14 parent 2 sees parent 1 submissions'; end if;
  -- 15 درس فيه رفع صورة فقط
  begin
    perform public.attach_photo(l2, s2, s2::text || '/' || l2::text || '/ok.jpg');
    pass := pass + 1;
  exception when others then fail := fail + 1; log := log || E'\n✗ 15 photo attach failed: ' || sqlerrm; end;
  execute 'reset role';

  -- ---------- المدرس ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_t1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  -- 16
  select count(*) into n from public.students;
  if n = 1 then pass := pass + 1; else fail := fail + 1; log := log || E'\n✗ 16 teacher sees other classes students: ' || n; end if;
  -- 17
  select count(*) into n from public.lessons where id = l2;
  if n = 0 then pass := pass + 1; else fail := fail + 1; log := log || E'\n✗ 17 teacher sees other class lesson'; end if;
  -- 18 تعليق المدرس
  select id into sub1 from public.submissions where student_id = s1 and lesson_id = l1;
  update public.submissions set teacher_comment = 'Great!' where id = sub1;
  get diagnostics n = row_count;
  if n = 1 then pass := pass + 1; else fail := fail + 1; log := log || E'\n✗ 18 teacher could not comment'; end if;
  -- 19 المدرس ما يشوف أكواد الطلاب
  select count(*) into n from public.student_codes;
  if n = 0 then pass := pass + 1; else fail := fail + 1; log := log || E'\n✗ 19 teacher can read student codes'; end if;
  execute 'reset role';

  -- ---------- الأكواد ----------
  -- 20 كود المدرس ما ينفع مرتين
  begin
    insert into auth.users (id, email, raw_user_meta_data) values (u_x, 'x@test.invalid', jsonb_build_object('invite_code', inv_code));
    fail := fail + 1; log := log || E'\n✗ 20 teacher code reused';
  exception when others then pass := pass + 1; end;
  -- 21 كود الطالب يقبل وليّين فقط
  insert into auth.users (id, email, raw_user_meta_data) values (u_p3, 'p3@test.invalid', jsonb_build_object('invite_code', code1));
  begin
    insert into auth.users (id, email, raw_user_meta_data) values (u_p4, 'p4@test.invalid', jsonb_build_object('invite_code', code1));
    fail := fail + 1; log := log || E'\n✗ 21 third guardian accepted';
  exception when others then pass := pass + 1; end;
  -- 22 كود غلط
  begin
    insert into auth.users (id, email, raw_user_meta_data) values (u_p4, 'p4@test.invalid', '{"invite_code":"JW-NOPE-NOPE"}');
    fail := fail + 1; log := log || E'\n✗ 22 invalid code accepted';
  exception when others then pass := pass + 1; end;

  -- ---------- زائر غير مسجّل ----------
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  -- 23
  begin
    select count(*) into n from public.students;
    fail := fail + 1; log := log || E'\n✗ 23 anon can read students';
  exception when others then pass := pass + 1; end;
  -- 24
  v := public.check_code(code2);
  if v = 'student' then pass := pass + 1; else fail := fail + 1; log := log || E'\n✗ 24 check_code failed for anon'; end if;
  execute 'reset role';

  raise exception '%', case when fail = 0
    then format(E'✅ ALL PASSED (%s/%s) — test data rolled back.', pass, pass + fail)
    else format(E'❌ FAILED %s of %s:%s', fail, pass + fail, log) end;
end $$;
