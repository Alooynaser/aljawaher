-- =====================================================================
--  روضة الجواهر — قاعدة بيانات بوابة أولياء الأمور والمدرسين
--  الصق هذا الملف كاملاً في Supabase ← SQL Editor ← Run
--  (آمن لإعادة التشغيل على مشروع جديد فقط)
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- الجداول
-- ---------------------------------------------------------------------

create table public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  role        text not null default 'parent' check (role in ('admin', 'teacher', 'parent')),
  full_name   text,
  phone       text,
  created_at  timestamptz not null default now()
);

create table public.classes (
  id          uuid primary key default gen_random_uuid(),
  name_ar     text not null,
  name_en     text not null default '',
  created_at  timestamptz not null default now()
);

create table public.class_teachers (
  class_id    uuid not null references public.classes on delete cascade,
  teacher_id  uuid not null references public.profiles on delete cascade,
  primary key (class_id, teacher_id)
);

create table public.students (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  class_id    uuid not null references public.classes on delete restrict,
  created_at  timestamptz not null default now()
);

-- أكواد التفعيل منفصلة عشان ما يشوفها إلا الإدارة
create table public.student_codes (
  student_id  uuid primary key references public.students on delete cascade,
  code        text not null unique
);

create table public.student_guardians (
  student_id  uuid not null references public.students on delete cascade,
  parent_id   uuid not null references public.profiles on delete cascade,
  linked_at   timestamptz not null default now(),
  primary key (student_id, parent_id)
);

create table public.teacher_invites (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  full_name   text not null,
  class_id    uuid references public.classes on delete set null,
  used_by     uuid references public.profiles on delete set null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create table public.lessons (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references public.classes on delete cascade,
  teacher_id  uuid references public.profiles on delete set null,
  title       text not null,
  body        text not null default '',
  video_url   text,
  has_quiz    boolean not null default true,
  allow_photo boolean not null default false,
  due_date    date,
  published   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.questions (
  id          uuid primary key default gen_random_uuid(),
  lesson_id   uuid not null references public.lessons on delete cascade,
  sort        int not null default 0,
  prompt      text not null,
  image_path  text,
  options     jsonb not null check (jsonb_typeof(options) = 'array')
);

-- الجواب الصحيح منفصل: ولي الأمر ما يقدر يقراه أبداً
create table public.question_keys (
  question_id   uuid primary key references public.questions on delete cascade,
  correct_index int not null
);

create table public.submissions (
  id              uuid primary key default gen_random_uuid(),
  lesson_id       uuid not null references public.lessons on delete cascade,
  student_id      uuid not null references public.students on delete cascade,
  answers         jsonb,
  score           int,
  total           int,
  photo_path      text,
  teacher_comment text,
  submitted_by    uuid references public.profiles on delete set null,
  submitted_at    timestamptz not null default now(),
  unique (lesson_id, student_id)
);

create index on public.students (class_id);
create index on public.lessons (class_id);
create index on public.questions (lesson_id);
create index on public.submissions (student_id);
create index on public.student_guardians (parent_id);

-- ---------------------------------------------------------------------
-- دوال مساعدة للصلاحيات (security definer = تتجاوز RLS بأمان)
-- ---------------------------------------------------------------------

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create function public.teaches(p_class uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.class_teachers where class_id = p_class and teacher_id = auth.uid());
$$;

create function public.is_guardian(p_student uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.student_guardians where student_id = p_student and parent_id = auth.uid());
$$;

create function public.parent_in_class(p_class uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.student_guardians g
    join public.students s on s.id = g.student_id
    where g.parent_id = auth.uid() and s.class_id = p_class
  );
$$;

create function public.student_class(p_student uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select class_id from public.students where id = p_student;
$$;

create function public.lesson_class(p_lesson uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select class_id from public.lessons where id = p_lesson;
$$;

create function public.can_edit_lesson(p_lesson uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin() or public.teaches(public.lesson_class(p_lesson));
$$;

create function public.lesson_visible(p_lesson uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.lessons l where l.id = p_lesson and (
      public.is_admin() or public.teaches(l.class_id) or (l.published and public.parent_in_class(l.class_id))
    )
  );
$$;

-- ---------------------------------------------------------------------
-- أكواد التفعيل
-- ---------------------------------------------------------------------

-- كود مثل JW-7K4P-M2XQ (بدون حروف تتلخبط مثل O/0 و I/1)
create function public.gen_code() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  b bytea := extensions.gen_random_bytes(8);
  s text := 'JW-';
begin
  for i in 0..7 loop
    if i = 4 then s := s || '-'; end if;
    s := s || substr(chars, (get_byte(b, i) % length(chars)) + 1, 1);
  end loop;
  return s;
end $$;

create function public.norm_code(p text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(upper(coalesce(p, '')), '[^A-Z0-9]', '', 'g');
$$;

alter table public.teacher_invites alter column code set default public.gen_code();

create function public.on_student_created() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.student_codes (student_id, code) values (new.id, public.gen_code());
  return new;
end $$;

create trigger student_code_after_insert
  after insert on public.students
  for each row execute function public.on_student_created();

-- منطق ربط الكود بالحساب (داخلي — ما يُستدعى مباشرة من المتصفح)
create function public._claim(p_uid uuid, p_code text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_norm text := public.norm_code(p_code);
  v_student uuid;
  v_inv public.teacher_invites;
  v_count int;
begin
  if v_norm = '' then raise exception 'CODE_INVALID'; end if;

  select student_id into v_student from public.student_codes where public.norm_code(code) = v_norm;
  if v_student is not null then
    if exists (select 1 from public.student_guardians where student_id = v_student and parent_id = p_uid) then
      return 'student';
    end if;
    select count(*) into v_count from public.student_guardians where student_id = v_student;
    if v_count >= 2 then raise exception 'CODE_FULL'; end if;
    insert into public.student_guardians (student_id, parent_id) values (v_student, p_uid);
    return 'student';
  end if;

  select * into v_inv from public.teacher_invites where public.norm_code(code) = v_norm for update;
  if found then
    if v_inv.used_by is not null then raise exception 'CODE_USED'; end if;
    update public.teacher_invites set used_by = p_uid, used_at = now() where id = v_inv.id;
    update public.profiles
       set role = case when role = 'admin' then 'admin' else 'teacher' end,
           full_name = coalesce(nullif(full_name, ''), v_inv.full_name)
     where id = p_uid;
    if v_inv.class_id is not null then
      insert into public.class_teachers (class_id, teacher_id) values (v_inv.class_id, p_uid) on conflict do nothing;
    end if;
    return 'teacher';
  end if;

  raise exception 'CODE_INVALID';
end $$;

-- ولي أمر مسجّل يضيف طفل ثاني
create function public.claim_code(p_code text) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'FORBIDDEN'; end if;
  return public._claim(auth.uid(), p_code);
end $$;

-- فحص الكود قبل التسجيل (يرجع student / teacher / null)
create function public.check_code(p_code text) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.student_codes where public.norm_code(code) = public.norm_code(p_code)) then 'student'
    when exists (select 1 from public.teacher_invites where public.norm_code(code) = public.norm_code(p_code) and used_by is null) then 'teacher'
  end;
$$;

-- الإدارة تغيّر كود طالب لو تسرّب
create function public.regenerate_code(p_student uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v text := public.gen_code();
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  update public.student_codes set code = v where student_id = p_student;
  return v;
end $$;

-- إنشاء الملف الشخصي تلقائياً عند التسجيل، وربط الكود لو موجود
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_code text := new.raw_user_meta_data ->> 'invite_code';
begin
  insert into public.profiles (id, full_name, phone)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'phone');
  if coalesce(v_code, '') <> '' then
    perform public._claim(new.id, v_code);
  end if;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- الدروس والحلول
-- ---------------------------------------------------------------------

-- حفظ درس كامل مع أسئلته في عملية وحدة
create function public.save_lesson(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_class uuid := (p ->> 'class_id')::uuid;
  v_q jsonb;
  v_qid uuid;
  v_keep uuid[] := '{}';
  v_i int := 0;
  v_correct int;
begin
  if not (public.is_admin() or public.teaches(v_class)) then raise exception 'FORBIDDEN'; end if;
  if coalesce(trim(p ->> 'title'), '') = '' then raise exception 'TITLE_REQUIRED'; end if;

  if v_id is null then
    insert into public.lessons (class_id, teacher_id, title, body, video_url, has_quiz, allow_photo, due_date, published)
    values (v_class, auth.uid(), trim(p ->> 'title'), coalesce(p ->> 'body', ''), nullif(trim(p ->> 'video_url'), ''),
            coalesce((p ->> 'has_quiz')::boolean, false), coalesce((p ->> 'allow_photo')::boolean, false),
            nullif(p ->> 'due_date', '')::date, coalesce((p ->> 'published')::boolean, false))
    returning id into v_id;
  else
    if not public.can_edit_lesson(v_id) then raise exception 'FORBIDDEN'; end if;
    update public.lessons set
      class_id = v_class, title = trim(p ->> 'title'), body = coalesce(p ->> 'body', ''),
      video_url = nullif(trim(p ->> 'video_url'), ''),
      has_quiz = coalesce((p ->> 'has_quiz')::boolean, false), allow_photo = coalesce((p ->> 'allow_photo')::boolean, false),
      due_date = nullif(p ->> 'due_date', '')::date, published = coalesce((p ->> 'published')::boolean, false),
      updated_at = now()
    where id = v_id;
  end if;

  for v_q in select * from jsonb_array_elements(coalesce(p -> 'questions', '[]'::jsonb)) loop
    v_i := v_i + 1;
    v_correct := (v_q ->> 'correct')::int;
    if coalesce(trim(v_q ->> 'prompt'), '') = ''
       or jsonb_typeof(v_q -> 'options') <> 'array'
       or jsonb_array_length(v_q -> 'options') not between 2 and 4
       or v_correct is null or v_correct < 0 or v_correct >= jsonb_array_length(v_q -> 'options') then
      raise exception 'QUESTION_INVALID %', v_i;
    end if;

    v_qid := nullif(v_q ->> 'id', '')::uuid;
    if v_qid is not null and exists (select 1 from public.questions where id = v_qid and lesson_id = v_id) then
      update public.questions set sort = v_i, prompt = trim(v_q ->> 'prompt'),
        image_path = nullif(v_q ->> 'image_path', ''), options = v_q -> 'options'
      where id = v_qid;
    else
      insert into public.questions (lesson_id, sort, prompt, image_path, options)
      values (v_id, v_i, trim(v_q ->> 'prompt'), nullif(v_q ->> 'image_path', ''), v_q -> 'options')
      returning id into v_qid;
    end if;

    insert into public.question_keys (question_id, correct_index) values (v_qid, v_correct)
    on conflict (question_id) do update set correct_index = excluded.correct_index;
    v_keep := v_keep || v_qid;
  end loop;

  delete from public.questions where lesson_id = v_id and not (id = any (v_keep));
  return v_id;
end $$;

-- التصحيح يصير هنا على السيرفر
create function public.submit_quiz(p_lesson uuid, p_student uuid, p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_lesson public.lessons;
  v_score int := 0;
  v_total int := 0;
  v_results jsonb := '[]'::jsonb;
  v_ans int;
  r record;
begin
  if not public.is_guardian(p_student) then raise exception 'FORBIDDEN'; end if;
  select * into v_lesson from public.lessons where id = p_lesson;
  if not found or not v_lesson.published or not v_lesson.has_quiz
     or v_lesson.class_id <> public.student_class(p_student) then
    raise exception 'FORBIDDEN';
  end if;

  for r in
    select q.id, k.correct_index from public.questions q
    join public.question_keys k on k.question_id = q.id
    where q.lesson_id = p_lesson order by q.sort
  loop
    v_total := v_total + 1;
    v_ans := nullif(regexp_replace(coalesce(p_answers ->> r.id::text, ''), '[^0-9]', '', 'g'), '')::int;
    if v_ans = r.correct_index then v_score := v_score + 1; end if;
    v_results := v_results || jsonb_build_object('id', r.id, 'correct', r.correct_index, 'ok', coalesce(v_ans = r.correct_index, false));
  end loop;

  insert into public.submissions (lesson_id, student_id, answers, score, total, submitted_by, submitted_at)
  values (p_lesson, p_student, p_answers, v_score, v_total, auth.uid(), now())
  on conflict (lesson_id, student_id) do update
    set answers = excluded.answers, score = excluded.score, total = excluded.total,
        submitted_by = excluded.submitted_by, submitted_at = now();

  return jsonb_build_object('score', v_score, 'total', v_total, 'results', v_results);
end $$;

-- ربط صورة الحل بالتسليم (بعد رفعها للتخزين)
create function public.attach_photo(p_lesson uuid, p_student uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_lesson public.lessons;
begin
  if not public.is_guardian(p_student) then raise exception 'FORBIDDEN'; end if;
  select * into v_lesson from public.lessons where id = p_lesson;
  if not found or not v_lesson.published or not v_lesson.allow_photo
     or v_lesson.class_id <> public.student_class(p_student)
     or p_path not like p_student::text || '/' || p_lesson::text || '/%' then
    raise exception 'FORBIDDEN';
  end if;

  insert into public.submissions (lesson_id, student_id, photo_path, submitted_by, submitted_at)
  values (p_lesson, p_student, p_path, auth.uid(), now())
  on conflict (lesson_id, student_id) do update
    set photo_path = excluded.photo_path, submitted_by = excluded.submitted_by, submitted_at = now();
end $$;

-- ---------------------------------------------------------------------
-- صلاحيات تنفيذ الدوال
-- ---------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.is_admin(), public.teaches(uuid), public.is_guardian(uuid), public.parent_in_class(uuid),
  public.student_class(uuid), public.lesson_class(uuid), public.can_edit_lesson(uuid), public.lesson_visible(uuid),
  public.norm_code(text), public.gen_code(), public.claim_code(text), public.regenerate_code(uuid),
  public.save_lesson(jsonb), public.submit_quiz(uuid, uuid, jsonb), public.attach_photo(uuid, uuid, text)
to authenticated;

grant execute on function public.check_code(text), public.norm_code(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------

alter table public.profiles          enable row level security;
alter table public.classes           enable row level security;
alter table public.class_teachers    enable row level security;
alter table public.students          enable row level security;
alter table public.student_codes     enable row level security;
alter table public.student_guardians enable row level security;
alter table public.teacher_invites   enable row level security;
alter table public.lessons           enable row level security;
alter table public.questions         enable row level security;
alter table public.question_keys     enable row level security;
alter table public.submissions       enable row level security;

-- ما فيه شي للزوار غير المسجّلين
revoke all on all tables in schema public from anon;

-- profiles: كل واحد يشوف نفسه، والإدارة تشوف الكل. التعديل على الاسم والرقم فقط (مو الدور)
create policy "profiles read" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy "profiles update self" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
revoke insert, update, delete on public.profiles from authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

-- classes
create policy "classes read" on public.classes for select to authenticated using (true);
create policy "classes admin" on public.classes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- class_teachers
create policy "class_teachers read" on public.class_teachers for select to authenticated
  using (teacher_id = auth.uid() or public.is_admin());
create policy "class_teachers admin" on public.class_teachers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- students
create policy "students read" on public.students for select to authenticated
  using (public.is_admin() or public.teaches(class_id) or public.is_guardian(id));
create policy "students admin" on public.students for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- student_codes: الإدارة فقط
create policy "codes admin" on public.student_codes for select to authenticated using (public.is_admin());

-- student_guardians: الربط يصير عن طريق الكود فقط، والإدارة تقدر تفك الربط
create policy "guardians read" on public.student_guardians for select to authenticated
  using (parent_id = auth.uid() or public.is_admin() or public.teaches(public.student_class(student_id)));
create policy "guardians admin delete" on public.student_guardians for delete to authenticated
  using (public.is_admin());

-- teacher_invites: الإدارة فقط
create policy "invites admin" on public.teacher_invites for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- lessons: الكتابة عن طريق save_lesson، والحذف للمدرس/الإدارة
create policy "lessons read" on public.lessons for select to authenticated
  using (public.is_admin() or public.teaches(class_id) or (published and public.parent_in_class(class_id)));
create policy "lessons delete" on public.lessons for delete to authenticated
  using (public.is_admin() or public.teaches(class_id));

-- questions / keys
create policy "questions read" on public.questions for select to authenticated
  using (public.lesson_visible(lesson_id));
create policy "keys read" on public.question_keys for select to authenticated
  using (exists (select 1 from public.questions q where q.id = question_id and public.can_edit_lesson(q.lesson_id)));

-- submissions: الإضافة عن طريق submit_quiz / attach_photo. المدرس يعدّل التعليق فقط
create policy "submissions read" on public.submissions for select to authenticated
  using (public.is_admin() or public.is_guardian(student_id) or public.teaches(public.lesson_class(lesson_id)));
create policy "submissions comment" on public.submissions for update to authenticated
  using (public.is_admin() or public.teaches(public.lesson_class(lesson_id)))
  with check (public.is_admin() or public.teaches(public.lesson_class(lesson_id)));
revoke insert, update on public.submissions from authenticated;
grant update (teacher_comment) on public.submissions to authenticated;

revoke insert, update on public.lessons, public.questions, public.question_keys,
  public.student_codes, public.student_guardians from authenticated;

-- ---------------------------------------------------------------------
-- التخزين (Storage)
-- ---------------------------------------------------------------------
-- lesson-media:  {class_id}/{file}              صور الأسئلة
-- submissions:   {student_id}/{lesson_id}/{file} صور حلول الأطفال (خاص)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('lesson-media', 'lesson-media', false, 5242880,  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  ('submissions',  'submissions',  false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "lesson-media read" on storage.objects for select to authenticated
  using (bucket_id = 'lesson-media' and (
    public.is_admin()
    or public.teaches(((storage.foldername(name))[1])::uuid)
    or public.parent_in_class(((storage.foldername(name))[1])::uuid)
  ));
create policy "lesson-media write" on storage.objects for insert to authenticated
  with check (bucket_id = 'lesson-media' and (
    public.is_admin() or public.teaches(((storage.foldername(name))[1])::uuid)
  ));

create policy "submissions read" on storage.objects for select to authenticated
  using (bucket_id = 'submissions' and (
    public.is_admin()
    or public.is_guardian(((storage.foldername(name))[1])::uuid)
    or public.teaches(public.student_class(((storage.foldername(name))[1])::uuid))
  ));
create policy "submissions write" on storage.objects for insert to authenticated
  with check (bucket_id = 'submissions' and public.is_guardian(((storage.foldername(name))[1])::uuid));
