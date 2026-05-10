-- Apply 6-month history retention to free plan (previously kept forever).
UPDATE wine_subscriptions
SET features = '["20 Lookup Credits","2 AI Image Credits","Cellar Tracker integration","Wine-Searcher integration","6-month history retention"]'
WHERE plan_name = 'free';
