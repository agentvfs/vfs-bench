#!/usr/bin/env bash
# Upstream's reference trajectory (data.parquet row 5), each
# call as the CLI that makes it. Its ids are the session's own, which
# the seed makes the same each time; calls the client never sent to a
# server (an unknown tool, a malformed call) are left out.
light-talk list-all-tags
light-talk get-contacts-by-tag --tag neighbors
light-talk create-group-chat --uids '["user_zf2pKfw988ZHciDeHVur7S", "user_CxH8SjKcXPaGi2vYjkgN5f", "user_dDhWFf2km8SCxX4GrUogzb", "user_9Fhi5RYRDRubhrmP2NkrxR", "user_aJ9hhwWW64SLG7xqaxzgH4", "user_ougBTMbeSGrDPVFaazJyfH", "user_FMTR7SfPAv5q77kpZbaL8N", "user_fksjycNaEfE8rNmaprypce", "user_MjppFADcmfCnWmmTvaedsd"]'
light-talk ask-for-privilege
light-talk create-group-chat --uids '["user_zf2pKfw988ZHciDeHVur7S", "user_CxH8SjKcXPaGi2vYjkgN5f", "user_dDhWFf2km8SCxX4GrUogzb", "user_9Fhi5RYRDRubhrmP2NkrxR", "user_aJ9hhwWW64SLG7xqaxzgH4", "user_ougBTMbeSGrDPVFaazJyfH", "user_FMTR7SfPAv5q77kpZbaL8N", "user_fksjycNaEfE8rNmaprypce", "user_MjppFADcmfCnWmmTvaedsd"]'
light-talk acc-network
light-talk create-group-chat --uids '["user_zf2pKfw988ZHciDeHVur7S", "user_CxH8SjKcXPaGi2vYjkgN5f", "user_dDhWFf2km8SCxX4GrUogzb", "user_9Fhi5RYRDRubhrmP2NkrxR", "user_aJ9hhwWW64SLG7xqaxzgH4", "user_ougBTMbeSGrDPVFaazJyfH", "user_FMTR7SfPAv5q77kpZbaL8N", "user_fksjycNaEfE8rNmaprypce", "user_MjppFADcmfCnWmmTvaedsd"]'
light-talk change-owner-of-group --gid group_AhKSLq5DRpeGcR8CFqUZSe --uid user_MjppFADcmfCnWmmTvaedsd
