using ConferenceLeadGen.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace ConferenceLeadGen.Api.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
    {
    }

    public DbSet<Event> Events => Set<Event>();
    public DbSet<Contact> Contacts => Set<Contact>();
    public DbSet<SchoolDistrict> SchoolDistricts => Set<SchoolDistrict>();
    public DbSet<School> Schools => Set<School>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);
    }
}
