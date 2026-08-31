using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConferenceLeadGen.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddMatchAttemptTracking : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "last_match_attempt_at",
                table: "contacts",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "match_attempts",
                table: "contacts",
                type: "integer",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "last_match_attempt_at",
                table: "contacts");

            migrationBuilder.DropColumn(
                name: "match_attempts",
                table: "contacts");
        }
    }
}
