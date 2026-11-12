# Create a batch of bookings

`POST /booking-batches` creates between one and ten bookings as one operation. The response contains the created booking views in request order. Existing single-booking endpoints keep their contracts.

```json
{
  "bookings": [
    { "id": "A", "resource": "R1", "start": 10, "end": 20 },
    { "id": "B", "resource": "R1", "start": 20, "end": 30 }
  ]
}
```

Each item follows the current create rules, including the time window, resource lookup and permanently occupied IDs. IDs must also be distinct within the request; the second occurrence of an ID is `422 invalid_data`. Validate the envelope and all item data, including repeated IDs, before resource, occupied-ID and overlap checks. For these later checks, process items in request order.

Active bookings of the same resource must not overlap, including bookings created by the same batch. Touching intervals and simultaneous intervals on different resources are allowed. Report a conflicting later item with its zero-based `index` and the conflicting stored or earlier-batch IDs in ascending character-code order. Canceled bookings do not occupy an interval, but their IDs remain taken.

The operation is atomic: every booking is created, or no booking is created and no ID is consumed. This applies both to a domain rejection and to a storage failure after earlier inserts. Existing bookings must remain unchanged.

| HTTP | Body |
|---|---|
| 201 | `{ "bookings": [<booking view>, ...] }` |
| 422 | `{ "error": "invalid_data", "index"?: <item> }` |
| 404 | `{ "error": "unknown_resource", "index": <item> }` |
| 409 | `{ "error": "id_taken", "index": <item> }` |
| 409 | `{ "error": "conflict", "index": <item>, "conflicts": [<id>, ...] }` |
| 503 | `{ "error": "unavailable", "index": <failed insert> }` |

`index` is omitted only for an invalid envelope. Unexpected storage failures use `unavailable`; a database uniqueness violation uses `id_taken`. A repeated ID within the request is an input error, distinct from an ID occupied before the request.

Concurrent requests remain outside this change's scope, as in the original PRD. The atomicity of one batch is required even when all requests are sequential. There is no frontend change in this PR.

Run the existing installation and database setup from the README, then `npm test`, `npm run lint`, `npm run typecheck` and `npm run build`. The batch unit tests are in `api/src/bookings/booking-batches.service.spec.ts`; existing HTTP integration tests continue to exercise the single-booking endpoints.
