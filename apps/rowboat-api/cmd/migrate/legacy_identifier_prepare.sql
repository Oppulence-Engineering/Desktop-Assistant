-- Legacy Ent databases already used the hashed names that the first Atlas
-- normalization migration expects to create. Move those names back only while
-- that migration is pending, so it can run once through its recorded history.
DO $$
DECLARE
  item record;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('revenueevidence_source_source_record_id_content_hash_revenue_wo', 'revenueevidence_source_source__9c29dc0e2c6e018629a5b95c5f67b4cf'),
    ('mailbodycache_provider_provider_message_id_user_mail_body_cache', 'mailbodycache_provider_provide_ae413139c02619b1f1f6a4b8ec947bdb'),
    ('revenueworkspacemember_revenue_workspace_id_user_revenue_worksp', 'revenueworkspacemember_revenue_f46244d2fcbd1226a029efb2ccf4c064'),
    ('backgroundtaskschedulestate_trigger_type_schedule_key_backgroun', 'backgroundtaskschedulestate_tr_181511ea152b19c130043609babd50ac'),
    ('conversationintelligenceartifact_kind_stable_id_version_revenue', 'conversationintelligenceartifa_18e34ca9891cfa2abaab44fce4a8fd9f'),
    ('conversationintelligenceartifact_kind_status_effective_at_relat', 'conversationintelligenceartifa_d17a9b4d130d85ad93e5d30c0b807c15'),
    ('relationshipattentionitem_status_rank_score_revenue_workspace_i', 'relationshipattentionitem_stat_2de7cf66b5cb84fb7562770b45a97572'),
    ('relationshipidentitycandidate_status_created_at_revenue_workspa', 'relationshipidentitycandidate__319f322f23ea306093cb05c6e5044719'),
    ('relationshipidentitydecision_candidate_version_identity_candida', 'relationshipidentitydecision_c_961e25e3e13f3a7f04c1192b6b3c826e'),
    ('relationshipidentitydecision_idempotency_key_revenue_workspace_', 'relationshipidentitydecision_i_f2b63056b1908df0dc63e581c5fd07b5'),
    ('relationshipobservation_source_external_id_source_version_reven', 'relationshipobservation_source_00d9f626f392471f5e836274ccfa36e7'),
    ('relationshipreviewacknowledgement_acknowledged_at_revenue_works', 'relationshipreviewacknowledgem_6e26ae93ef39be4c8ad6cbbfb65233b4'),
    ('relationshipreviewacknowledgement_state_version_relationship_id', 'relationshipreviewacknowledgem_722bb323c371ca7720376303de1a7b5b'),
    ('relationshipsourcestatus_source_source_account_id_revenue_works', 'relationshipsourcestatus_sourc_e9da2ca23700d2dafd7efd04e5a33b03')
  ) AS names(source_name, target_name)
  LOOP
    IF to_regclass(item.source_name) IS NULL AND to_regclass(item.target_name) IS NOT NULL THEN
      EXECUTE format('ALTER INDEX %I RENAME TO %I', item.target_name, item.source_name);
    END IF;
  END LOOP;

  FOR item IN SELECT * FROM (VALUES
    ('background_task_schedule_states', 'background_task_schedule_states_background_tasks_schedule_state', 'background_task_schedule_state_41881d7227518ea10fe18f5f94d3c979'),
    ('background_task_schedule_states', 'background_task_schedule_states_users_background_task_schedule_', 'background_task_schedule_state_2cee65f7000b363b766c694c83fc498a'),
    ('commitment_dependencies', 'commitment_dependencies_revenue_workspaces_commitment_dependenc', 'commitment_dependencies_revenu_92d2eb5a75a66294d280100b545c9de1'),
    ('conversation_intelligence_artifacts', 'conversation_intelligence_artifacts_relationships_conversation_', 'conversation_intelligence_arti_dbc45a86d7780b23c39c20426d3dc5fb'),
    ('conversation_intelligence_artifacts', 'conversation_intelligence_artifacts_revenue_workspaces_conversa', 'conversation_intelligence_arti_1e63f30e8e9419065fc343e9c96e8fcb'),
    ('conversation_intelligence_artifacts', 'conversation_intelligence_artifacts_users_conversation_intellig', 'conversation_intelligence_arti_830936ebd4345e9acc8687a33c237c44'),
    ('person_interaction_stats', 'person_interaction_stats_revenue_workspaces_person_interaction_', 'person_interaction_stats_reven_1a676f2b23db32df6afc400873893086'),
    ('person_merge_candidates', 'person_merge_candidates_relationship_persons_existing_merge_can', 'person_merge_candidates_relati_45e808c38d107cc49fbab0e108ad114e'),
    ('person_merge_candidates', 'person_merge_candidates_relationship_persons_proposed_merge_can', 'person_merge_candidates_relati_7c868c8e12c58a76649e70f51549ebb9'),
    ('person_merge_candidates', 'person_merge_candidates_revenue_workspaces_person_merge_candida', 'person_merge_candidates_revenu_4c3c0c54b5257649793ce552b278651a'),
    ('relationship_assertions', 'relationship_assertions_revenue_workspaces_relationship_asserti', 'relationship_assertions_revenu_cfd12cbb1ca73669db264b0dfd51c59b'),
    ('relationship_attention_items', 'relationship_attention_items_revenue_workspaces_relationship_at', 'relationship_attention_items_r_08f9696c627d891d88bc4d81e117365c'),
    ('relationship_identities', 'relationship_identities_revenue_workspaces_relationship_identit', 'relationship_identities_revenu_e0b8453ee8d90d15355391803ac140cc'),
    ('relationship_identity_candidates', 'relationship_identity_candidates_relationships_existing_identit', 'relationship_identity_candidat_ae88835d2249b6d38bd2f533de654ecf'),
    ('relationship_identity_candidates', 'relationship_identity_candidates_relationships_proposed_identit', 'relationship_identity_candidat_558b8e00693216003504e2b81ecb523f'),
    ('relationship_identity_candidates', 'relationship_identity_candidates_revenue_workspaces_identity_ca', 'relationship_identity_candidat_5df84cd4e08a126f8e3acc4218500a7b'),
    ('relationship_identity_candidates', 'relationship_identity_candidates_users_relationship_identity_ca', 'relationship_identity_candidat_41655d93299b45606450cf3215342f9a'),
    ('relationship_identity_decisions', 'relationship_identity_decisions_relationship_identity_candidate', 'relationship_identity_decision_98a746f78bc1a72238af2e16e0e64297'),
    ('relationship_identity_decisions', 'relationship_identity_decisions_revenue_workspaces_relationship', 'relationship_identity_decision_3358c713811cac11a37178177aa2144a'),
    ('relationship_identity_decisions', 'relationship_identity_decisions_users_relationship_identity_dec', 'relationship_identity_decision_943cf3cec1c94f9e9dac9d6131b3f25b'),
    ('relationship_lineage_events', 'relationship_lineage_events_relationship_identity_candidates_li', 'relationship_lineage_events_re_153de87cb2a9a7540e720323891a5913'),
    ('relationship_lineage_events', 'relationship_lineage_events_revenue_workspaces_relationship_lin', 'relationship_lineage_events_re_0c3d3b5af96265efa66a92bcab3fb986'),
    ('relationship_observations', 'relationship_observations_revenue_workspaces_relationship_obser', 'relationship_observations_reve_5c2e238af69e7038a10e95ab07491e9e'),
    ('relationship_participants', 'relationship_participants_revenue_workspaces_relationship_parti', 'relationship_participants_reve_b92f91fcd1726b66d7b79eb4e2a03861'),
    ('relationship_projection_jobs', 'relationship_projection_jobs_revenue_workspaces_relationship_pr', 'relationship_projection_jobs_r_ee99889c305a24c0a389fdce2a61ab71'),
    ('relationship_review_acknowledgements', 'relationship_review_acknowledgements_relationships_review_ackno', 'relationship_review_acknowledg_bfcfc733623eb171a12a89f7da3916cb'),
    ('relationship_review_acknowledgements', 'relationship_review_acknowledgements_revenue_workspaces_relatio', 'relationship_review_acknowledg_e29235dbcf290bb98a53fdf68fa05970'),
    ('relationship_review_acknowledgements', 'relationship_review_acknowledgements_users_relationship_review_', 'relationship_review_acknowledg_3c0c9190cb433935fda6a82e0a7cb36d'),
    ('relationship_source_status', 'relationship_source_status_revenue_workspaces_relationship_sour', 'relationship_source_status_rev_5d90ff6d5153f9ef9f937c47b30faac3'),
    ('relationship_state_snapshots', 'relationship_state_snapshots_revenue_workspaces_relationship_st', 'relationship_state_snapshots_r_a605a2357bd8e0c0c5dcd8f742af075e')
  ) AS names(table_name, source_name, target_name)
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = item.table_name AND c.conname = item.target_name
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = item.table_name AND c.conname = item.source_name
    ) THEN
      EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', item.table_name, item.target_name, item.source_name);
    END IF;
  END LOOP;
END
$$;
