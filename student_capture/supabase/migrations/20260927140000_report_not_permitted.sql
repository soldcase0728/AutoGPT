-- Students can say a prompt can't be done because a teacher or coach won't
-- allow it (filming in class, in the locker room, at practice).
alter type safety_kind add value if not exists 'not_permitted';
