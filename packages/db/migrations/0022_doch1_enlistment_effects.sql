-- סטטוס גיוס values made by the 0020 backfill or a first import all started as pending ("ממתין"),
-- so "התייצב" never counted on the יום גיוס screen. Give the values still on that default the effect
-- their words say — the same rules as guessEnlistmentEffect() in packages/core/src/doch1/counting.ts.
-- A value the admin already set to another effect is left alone.
update public.doch1_field_options set effect = case
    when name ~ '(טרם|לא\s*התייצב|נפקד|בדרך)' then 'pending'
    when name ~ '(נדח|דחי)' then 'postponed'
    when name ~ '(שוחרר|שחרור|פטור)' then 'released'
    when name ~ '(התייצב|הגיע|נקלט)' then 'arrived'
    else effect
  end
where field = 'enlistment' and effect = 'pending';
