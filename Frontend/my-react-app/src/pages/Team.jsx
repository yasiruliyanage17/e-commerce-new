import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import TeamNavbar from '/src/components/Team/TeamNavbar';
import HeroSection from '/src/components/Team/HeroSection';
import LeaderCard from '/src/components/Team/LeaderCard';
import TeamCard from '/src/components/Team/TeamCard';
import FooterCTA from '/src/components/Team/FooterCTA';
import arjunImg from '/src/assets/arjun.png';
import geethmaImg from '/src/assets/geethma.png';
import yunethImg from '/src/assets/yuneth.png';
import yasiruImg from '/src/assets/yasiru.png';
import TharushaImg from '/src/assets/tharusha.png';

// ✅ Team Members Data (Add new objects here to expand the team)
const teamMembers = [
  {
    id: 1,
    name: "Geethma Chandoopa",
    role: "Machine Learning Engineer & Team Coordinator",
    image: geethmaImg,
    objectPosition: "object-top",
    imageZoom: "scale-100",
    bio: "Passionate about creating intuitive and beautiful user experiences."
  },
  {
    id: 2,
    name: "Yuneth Hansira",
    role: "System Architect Engineer & Full Stack Developer UI designer",
    image: yunethImg,
    objectPosition: "object-[10%_-20%]",
    imageZoom: "scale-150",
    bio: "React enthusiast with a focus on performance and accessibility."
  },
  {
    id: 3,
    name: "Yasiru Liyanage",
    role: "DevOps Engineer & Backend Developer ",
    image: yasiruImg,
    objectPosition: "object-[10%_-25%]",
    imageZoom: "scale-[1.15]",
    bio: "Architecting scalable systems and secure APIs."
  },
  {
    id: 4,
    name: "Tharusha Induwara",
    role: "Backend Developer",
    image: TharushaImg,
    objectPosition: "object-top ",
    imageZoom: "scale-[0.95]",
    bio: "Automating workflows and ensuring 99.9% uptime."
  }
];

const Team = () => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="min-h-screen smooth-bg selection:bg-[#4DA3FF] selection:text-[#0A1F44] overflow-x-hidden">
      <TeamNavbar />

      <main>
        <HeroSection />

        <div className="max-w-7xl mx-auto px-6">
          <LeaderCard />

          <section className="py-20">
            <div className="flex flex-col md:flex-row justify-between items-end mb-16 gap-4">
              <div>
                <h3 className="text-3xl font-bold text-white mb-2">Our Brilliant Minds</h3>
                <p className="text-gray-400">The core team driving our success everyday.</p>
              </div>
              <div className="w-full md:w-auto h-px bg-gradient-to-r from-[#4DA3FF]/50 to-transparent flex-1 mx-8 hidden lg:block" />
              <div className="flex items-center gap-4">
                <span className="text-sm font-medium text-[#4DA3FF] uppercase tracking-widest">Filter by Department</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
              {teamMembers.map((member) => (
                <TeamCard key={member.id} member={member} />
              ))}
            </div>
          </section>
        </div>

        <FooterCTA />
      </main>

      <footer className="py-12 border-t border-white/5 text-center">
        <p className="text-gray-500 text-sm">
          &copy; {new Date().getFullYear()} BEETA. All rights reserved.
        </p>
      </footer>
    </div>
  );
};

export default Team;
