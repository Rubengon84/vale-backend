-- Names that are email addresses (Auth0's default for email/password
-- accounts) were visible to other members. Keep only a readable name,
-- matching safeDisplayName in src/names.js: "juan.perez83@x.com" -> "Juan Perez".
UPDATE users
SET name = COALESCE(
      NULLIF(
        initcap(trim(regexp_replace(
          regexp_replace(regexp_replace(split_part(name, '@', 1), '[._+-]+', ' ', 'g'), '[0-9]+', '', 'g'),
          '\s+', ' ', 'g'))),
        ''),
      'Miembro'),
    updated_at = now()
WHERE name ~ '[^\s@]+@[^\s@]+';
