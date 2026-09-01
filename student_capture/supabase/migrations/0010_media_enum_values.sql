-- Enum label changes must commit before later migrations use the new values.

alter type prompt_media_type rename value 'PHOTO' to 'photo';
alter type prompt_media_type rename value 'VIDEO' to 'video';
alter type prompt_media_type add value 'photo_series';

alter type prompt_orientation rename value 'PORTRAIT' to 'portrait';
alter type prompt_orientation rename value 'LANDSCAPE' to 'landscape';
alter type prompt_orientation rename value 'ANY' to 'any';
alter type prompt_orientation add value 'square';
