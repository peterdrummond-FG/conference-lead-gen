using System.Collections.Concurrent;
using System.Threading.Channels;

namespace ConferenceLeadGen.Api.Services;

// Registered as a singleton. POST /api/contacts enqueues a contact id right
// after saving and returns immediately — the kiosk never waits on Zoho or a
// web search. MatchingBackgroundService is the sole reader.
public class MatchingQueue
{
    private readonly Channel<Guid> _channel = Channel.CreateUnbounded<Guid>();
    private readonly ConcurrentDictionary<Guid, byte> _inFlight = new();

    public ChannelReader<Guid> Reader => _channel.Reader;

    // Idempotent: a contact already queued or currently being processed is
    // silently skipped rather than double-enqueued. Without this,
    // MatchingRetryScanner's 10-minute idle sweep can re-enqueue a contact
    // that's still mid-pipeline (worst case ~12 minutes: two skills, two
    // attempts each, 180s timeout per attempt), causing it to be reprocessed
    // concurrently/sequentially and occasionally overwriting a good result
    // with a worse one, since the underlying skills are LLM-driven and not
    // deterministic. Tradeoff: a manual "Retry match" click that races the
    // tail end of an in-flight run (before Complete() fires) is also
    // dropped with no feedback — acceptable for this pilot.
    public void Enqueue(Guid contactId)
    {
        if (_inFlight.TryAdd(contactId, 0))
        {
            _channel.Writer.TryWrite(contactId);
        }
    }

    public void Complete(Guid contactId) => _inFlight.TryRemove(contactId, out _);
}
