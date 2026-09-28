-- Duplicating a task used to add " — copy" (or " (copy)") to its title, once
-- per duplicate. Students and the Queue saw it. The app no longer adds it and
-- strips it on save; this cleans up the titles already stored.
update ideas
   set title = btrim(regexp_replace(title, '(\s*([—–-]\s*copy|\(copy\)))+\s*$', '', 'i'))
 where title ~* '(\s*([—–-]\s*copy|\(copy\)))+\s*$';
