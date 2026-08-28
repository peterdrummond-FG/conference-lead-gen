using System.Threading.Channels;

namespace ConferenceLeadGen.Api.Services;

// Registered as a singleton. POST /api/contacts enqueues a contact id right
// after saving and returns immediately — the kiosk never waits on Zoho or a
// web search. MatchingBackgroundService is the sole reader.
public class MatchingQueue
{
    private readonly Channel<Guid> _channel = Channel.CreateUnbounded<Guid>();

    public ChannelReader<Guid> Reader => _channel.Reader;

    public void Enqueue(Guid contactId) => _channel.Writer.TryWrite(contactId);
}
