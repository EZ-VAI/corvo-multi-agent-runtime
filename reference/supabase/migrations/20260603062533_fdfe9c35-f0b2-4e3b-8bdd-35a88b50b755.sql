-- Add `pending` jsonb to brand_brain and product_brain so the agent can
-- separate confirmed/high-confidence inferences (main columns: essence,
-- anti_identity, visual_dna, tonal_register, truth, value_proposition, etc.)
-- from low-confidence / generic-category extrapolations.
--
-- Contract for writers (VPS agent + brainPipe):
--   - Main columns: only items the agent can defend with a direct anchor in
--     the source material (URL scrape, product image, visual_dna, etc.)
--   - `pending` column: same shape as the main columns, but for items that
--     are reasonable-but-generic ("any premium beauty brand would say this").
--     Example: pending = {
--       "anti_identity": { "never_be": ["Cluttered or Chaotic"], "_reason": "generic-category" }
--     }
--   - Downstream decision layers (generate-blocks, generate-keyframes, etc.)
--     MUST treat main columns as hard constraints, and `pending` as soft hints
--     only. Brand confirmation moves items pending -> main.
--
-- Default empty object so existing reads stay valid.

ALTER TABLE public.brand_brain
  ADD COLUMN IF NOT EXISTS pending jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.product_brain
  ADD COLUMN IF NOT EXISTS pending jsonb NOT NULL DEFAULT '{}'::jsonb;